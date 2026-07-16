// The notesd **config plane**: a small `notesd.json` file at a connected cloud
// backend's app-folder root (beside `settings.json` / `namespaces.json`) that
// lists the self-hosted daemons you've paired, so your *other* devices can
// discover a daemon's address and certificate pin without re-typing or
// re-scanning them. "Config from the cloud, data from home."
//
// ## Deliberately credential-free
//
// The published entry carries only the daemon's **name, endpoint, and SPKI
// pin** — never a device key or pairing token. Two reasons:
//   1. Keys are per-device and individually revocable (that's the whole point
//      of the pairing model); sharing one device's key to another through the
//      cloud would throw that away.
//   2. Nothing sensitive then lives on the third-party cloud. The pin is a
//      public-key fingerprint by nature and the endpoint is just an address;
//      neither grants access to notes without a key. So this file is stored as
//      plaintext JSON — there is nothing in it to hide from the provider.
//
// A device that discovers a daemon here still completes pairing itself (redeem
// a fresh token, or supply the static key) to obtain *its own* credential — the
// address and pin are simply pre-filled. That keeps the security model intact
// while removing the tedious part of multi-device setup.

import type { FileStore } from "../file-store.ts";

/** The file name at the cloud app-folder root. */
export const CONFIG_PLANE_FILE = "notesd.json";

/** One daemon's non-secret discovery record, as published to the cloud. */
export interface PublishedDaemon {
  name: string;
  /** `https://host:port` base URL. */
  endpoint: string;
  /** SPKI pin, `sha256:<base64>`. Its identity in the list. */
  fingerprint: string;
}

/** A load/save seam over the root `notesd.json`, per connected cloud backend. */
export interface ConfigPlaneStore {
  load(): Promise<string | null>;
  save(text: string): Promise<void>;
}

/** Build a config-plane store over a `FileStore` rooted at the app folder. */
export function fileConfigPlaneStore(rootStore: FileStore): ConfigPlaneStore {
  return {
    load: () => rootStore.read(CONFIG_PLANE_FILE),
    save: async (text) => {
      await rootStore.write(CONFIG_PLANE_FILE, text);
    },
  };
}

function isDaemon(value: unknown): value is PublishedDaemon {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.name === "string" &&
    typeof d.endpoint === "string" &&
    typeof d.fingerprint === "string" &&
    d.endpoint.startsWith("https://") &&
    d.fingerprint.startsWith("sha256:")
  );
}

/**
 * Parse `notesd.json` into a clean daemon list: drop malformed entries and
 * collapse duplicates by fingerprint (the daemon's stable identity). A missing
 * or corrupt file yields an empty list rather than throwing.
 */
export function parseConfigPlane(raw: string | null): PublishedDaemon[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = (parsed as { daemons?: unknown })?.daemons;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: PublishedDaemon[] = [];
  for (const entry of list) {
    if (!isDaemon(entry)) continue;
    if (seen.has(entry.fingerprint)) continue;
    seen.add(entry.fingerprint);
    out.push({
      name: entry.name,
      endpoint: entry.endpoint,
      fingerprint: entry.fingerprint,
    });
  }
  return out;
}

/** Serialize a daemon list to the JSON written into `notesd.json`. */
export function serializeConfigPlane(daemons: PublishedDaemon[]): string {
  return JSON.stringify({ v: 1, daemons }, null, 2);
}

/**
 * Insert or replace a daemon in the list, keyed by fingerprint, preserving the
 * order of the others (a re-publish updates the name/endpoint in place).
 */
export function upsertDaemon(
  list: PublishedDaemon[],
  daemon: PublishedDaemon,
): PublishedDaemon[] {
  const next = list.filter((d) => d.fingerprint !== daemon.fingerprint);
  next.push(daemon);
  return next;
}

/** Read the published daemon list from a config-plane store. */
export async function readPublishedDaemons(
  store: ConfigPlaneStore,
): Promise<PublishedDaemon[]> {
  return parseConfigPlane(await store.load());
}

/** Publish (insert-or-update) one daemon into the config plane. */
export async function publishDaemon(
  store: ConfigPlaneStore,
  daemon: PublishedDaemon,
): Promise<void> {
  const current = parseConfigPlane(await store.load());
  await store.save(serializeConfigPlane(upsertDaemon(current, daemon)));
}
