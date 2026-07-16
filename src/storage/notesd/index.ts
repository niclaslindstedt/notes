// notesd-backed `StorageAdapter`: a self-hosted sync backend that talks to the
// user's own `notesd` daemon over an SPKI-pinned HTTPS connection.
//
// ## Whole-document, like the browser backend
//
// The daemon serves a flat folder addressed by single-component refs, with no
// attachment-listing endpoint and no notion of note-folders. Rather than bend
// the per-note directory adapter (Dropbox/Drive/folder) onto that shape, this
// adapter stores the **entire serialized snapshot as one file per namespace** —
// exactly how `BrowserLocalStorageAdapter` treats localStorage, just over the
// network. So image attachments ride inline in the document (as they do on the
// browser backend) and at-rest encryption composes one level up in
// `withEncryption` (see `useStorageBackend`), which seals the whole blob.
//
// ## Transport
//
// The `fetchImpl` is the seam that makes this native-only: the wrapper passes
// `createPinnedFetch(spkiPin)` (see `src/platform/native-bridge.ts`), which
// routes the request through native code that validates the daemon's
// self-signed certificate against its pinned SPKI fingerprint. On the plain web
// that pinned fetch rejects, which is why the picker only offers notesd inside
// the native app.
//
// ## Concurrency
//
// Every request carries `Authorization: Bearer <deviceKey>`. `save` sends the
// last-seen revision as `If-Match`; the daemon answers **409** with the current
// bytes when the remote has moved, which becomes a `ConflictError` carrying the
// newer snapshot — the app's existing keep-mine / keep-theirs flow, unchanged.

import { createLogger } from "../../dev/logger.ts";
import {
  ConflictError,
  type StorageAdapter,
  type StoredSnapshot,
} from "../adapter.ts";
import type { NotesdConfig } from "../backend-preference.ts";
import { DEFAULT_NAMESPACE_SLUG } from "../namespaces.ts";
import {
  NAMESPACES_FILE_NAME,
  type NamespaceRegistryStore,
} from "../namespace-store.ts";
import { SETTINGS_FILE_NAME, type SettingsStore } from "../settings-store.ts";
import { notesdError } from "./errors.ts";

const log = createLogger("notesd");

export type FetchImpl = typeof fetch;

// Match the cloud backends' 1-second coalescing window: rapid edits within a
// gesture collapse into one network save.
const SAVE_DEBOUNCE_MS = 1000;

// How often the `watch` shim probes the daemon's aggregate revision. The daemon
// serves `GET /v1/rev` in O(1), so this is a cheap round trip — snappier than
// the sync engine's whole-document live pull (10s), which the watch capability
// switches off in favour of "only load when something actually moved". True
// server push (the daemon's `GET /v1/events` SSE stream) can't ride the
// request/response pinned transport yet, so this poll is the shim; see the
// issue tracker for the SSE-over-bridge follow-up.
const WATCH_POLL_INTERVAL_MS = 4000;

// The document ref for a namespace. The default namespace owns `document.json`
// (the daemon reserves only settings.json / namespaces.json, so this is free);
// every other namespace gets a per-slug file beside it, keeping them isolated
// on the one daemon folder.
function documentRef(namespace: string): string {
  return namespace === DEFAULT_NAMESPACE_SLUG
    ? "document.json"
    : `document-${namespace}.json`;
}

/**
 * Build a notesd adapter for one namespace. `fetchImpl` must be an SPKI-pinned
 * fetch bound to the daemon's certificate (`createPinnedFetch(config.spkiPin)`);
 * the raw global `fetch` would fail TLS against the self-signed cert.
 */
export function createNotesdAdapter(
  config: NotesdConfig,
  fetchImpl: FetchImpl,
  namespace: string = DEFAULT_NAMESPACE_SLUG,
): StorageAdapter {
  const ref = documentRef(namespace);
  const url = `${config.endpoint}/v1/notes/${ref}`;
  const revUrl = `${config.endpoint}/v1/rev`;
  log.info(`adapter created ns=${namespace}`);

  function authed(init: RequestInit): RequestInit {
    return {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${config.deviceKey}`,
      },
    };
  }

  async function loadSnapshot(): Promise<StoredSnapshot | null> {
    const res = await fetchImpl(url, authed({ method: "GET" }));
    if (res.status === 404) return null;
    if (!res.ok) throw await notesdError("load", res);
    const text = await res.text();
    const revision = res.headers.get("etag") ?? undefined;
    return { text, revision };
  }

  return {
    id: "notesd",
    // `watch` is a light poll of the daemon's aggregate revision that stands in
    // for true server push; the sync engine gates on this capability to swap its
    // whole-document live pull for "load only when the revision moves".
    capabilities: new Set(["watch"]),
    label: config.name || "Self-hosted",
    saveDebounceMs: SAVE_DEBOUNCE_MS,

    load: loadSnapshot,

    async save(text: string, baseRevision?: string): Promise<StoredSnapshot> {
      const headers: Record<string, string> = {
        "Content-Type": "application/octet-stream",
      };
      // Optimistic concurrency: only overwrite if the remote is still at the
      // revision we based this edit on. A first save (no base) writes
      // unconditionally.
      if (baseRevision) headers["If-Match"] = baseRevision;

      const res = await fetchImpl(
        url,
        authed({ method: "PUT", headers, body: text }),
      );

      if (res.status === 409) {
        // The remote moved. Hand back its current bytes + revision so the
        // caller can resolve, exactly like the cloud backends' ConflictError.
        const remoteText = await res.text();
        const revision = res.headers.get("etag") ?? undefined;
        throw new ConflictError({ text: remoteText, revision });
      }
      if (!res.ok) throw await notesdError("save", res);

      const meta = (await res.json()) as { etag?: string };
      return { text, revision: meta.etag };
    },

    // Live push, shimmed. The daemon's real push channel is the `GET /v1/events`
    // SSE stream, but the pinned transport is request/response only — SSE can't
    // ride it as-is — so instead this polls the O(1) `GET /v1/rev` aggregate
    // revision and, when it moves, re-loads the document and hands the fresh
    // snapshot to the sync engine. The engine applies it under the same "never
    // clobber unsaved text" guards its live pull uses, and only when the
    // document's etag actually changed — so our own writes echoing back (or a
    // sibling namespace's rev bump) don't churn the screen. Returns an
    // unsubscribe that stops the poll.
    watch(onRemoteChange: (snapshot: StoredSnapshot) => void): () => void {
      // The last aggregate revision we saw. `undefined` until the first probe
      // seeds it — a fresh subscription never delivers on its opening tick, only
      // on a *subsequent* move, so subscribing can't spuriously re-adopt what's
      // already on screen.
      let lastRev: unknown;
      let seeded = false;
      let stopped = false;
      // At most one probe in flight: a slow `/v1/rev` + `load()` must not overlap
      // the next tick, or a burst of ticks would stack concurrent loads.
      let busy = false;

      const tick = async (): Promise<void> => {
        if (stopped || busy) return;
        busy = true;
        try {
          const res = await fetchImpl(revUrl, authed({ method: "GET" }));
          // A transient failure (offline, 401 mid-rotation) just skips this
          // tick; the next one retries. Nothing to surface — the next save/load
          // raises anything that actually matters.
          if (!res.ok) return;
          const { rev } = (await res.json()) as { rev?: unknown };
          if (!seeded) {
            lastRev = rev;
            seeded = true;
            return;
          }
          if (rev === lastRev) return;
          lastRev = rev;
          const snapshot = await loadSnapshot();
          if (stopped || snapshot === null) return;
          onRemoteChange(snapshot);
        } catch (err) {
          log.warn("watch: revision probe failed", err);
        } finally {
          busy = false;
        }
      };

      const id = setInterval(() => void tick(), WATCH_POLL_INTERVAL_MS);
      // Seed the baseline right away so the first real change lands within one
      // interval rather than two.
      void tick();

      return () => {
        stopped = true;
        clearInterval(id);
      };
    },
  };
}

// A root store (`settings.json` / `namespaces.json`) over the daemon's
// `GET/PUT /v1/settings/{name}` endpoint. The daemon reserves both names (its
// `RESERVED` / `ALLOWED_SETTINGS` lists), keeping them out of note listings, so
// appearance settings and the namespace registry sync across every paired
// device — the way they already do on the folder/cloud backends via their
// root-scoped `FileStore`. These files are app-wide plaintext JSON (theme/font
// choices and namespace names aren't secret, and stay readable behind the
// unlock gate), so unlike the document adapter they carry no whole-document
// encryption. `fetchImpl` must be the same SPKI-pinned fetch the adapter uses.
function createNotesdRootStore(
  config: NotesdConfig,
  fetchImpl: FetchImpl,
  name: string,
): { load(): Promise<string | null>; save(text: string): Promise<void> } {
  const url = `${config.endpoint}/v1/settings/${name}`;
  const authHeader = { Authorization: `Bearer ${config.deviceKey}` };
  return {
    async load(): Promise<string | null> {
      const res = await fetchImpl(url, {
        method: "GET",
        headers: { ...authHeader },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw await notesdError(`load ${name}`, res);
      return res.text();
    },
    async save(text: string): Promise<void> {
      const res = await fetchImpl(url, {
        method: "PUT",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: text,
      });
      if (!res.ok) throw await notesdError(`save ${name}`, res);
    },
  };
}

/**
 * The notesd backend's root settings store — `settings.json` served by the
 * daemon at `/v1/settings/settings.json`, so appearance settings travel with
 * the daemon and land on every paired device (the notesd counterpart of
 * {@link createDropboxSettingsStore} / the folder settings store).
 */
export function createNotesdSettingsStore(
  config: NotesdConfig,
  fetchImpl: FetchImpl,
): SettingsStore {
  return createNotesdRootStore(config, fetchImpl, SETTINGS_FILE_NAME);
}

/**
 * The notesd backend's root namespace-registry store — `namespaces.json` served
 * by the daemon at `/v1/settings/namespaces.json`, so the list of namespaces
 * created on one paired device appears on the others.
 */
export function createNotesdNamespaceStore(
  config: NotesdConfig,
  fetchImpl: FetchImpl,
): NamespaceRegistryStore {
  return createNotesdRootStore(config, fetchImpl, NAMESPACES_FILE_NAME);
}

/**
 * Delete a namespace's document on the daemon (`DELETE /v1/notes/document-…`),
 * so removing a namespace on this device doesn't orphan its bytes on the shared
 * daemon — the notesd counterpart of {@link deleteDropboxNamespace}. The default
 * namespace (`document.json`) is never deleted. A 404 means it's already gone.
 */
export async function deleteNotesdNamespace(
  config: NotesdConfig,
  fetchImpl: FetchImpl,
  namespace: string,
): Promise<void> {
  if (namespace === DEFAULT_NAMESPACE_SLUG) return;
  const url = `${config.endpoint}/v1/notes/${documentRef(namespace)}`;
  const res = await fetchImpl(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${config.deviceKey}` },
  });
  if (res.status === 404) return;
  if (!res.ok) throw await notesdError(`delete ${namespace}`, res);
}
