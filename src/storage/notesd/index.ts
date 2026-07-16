// notesd-backed `StorageAdapter`: a self-hosted sync backend that talks to the
// user's own `notesd` daemon over an SPKI-pinned HTTPS connection.
//
// ## A directory backend, like folder / Dropbox / Drive
//
// The daemon serves a plain folder as a **generic blob store** keyed by a safe
// relative path (`GET /v1/blobs?prefix=`, `GET/PUT/DELETE /v1/blob/{*path}`), so
// this backend is wired exactly like the file/cloud ones: a `FileStore` moves a
// note's markdown and an `AttachmentStore` moves an image's bytes, and the
// shared `createDirectoryAdapter` owns the markdown↔snapshot conversion,
// per-file at-rest encryption, conflict detection, and attachment
// externalisation. Each namespace is scoped to its own `notes/` /
// `attachments/` subfolder (`namespaceNotesFolder` / `namespaceAttachmentsFolder`)
// on the one daemon folder — the same layout the folder backend writes, so the
// daemon's folder is directly openable by the web folder backend.
//
// Because encryption now composes **per file inside** the directory adapter (via
// the injected `DirectoryCrypto`), there is no whole-document `withEncryption`
// wrapper for notesd in `useStorageBackend` — it sits with the folder/cloud
// backends, not the single-document browser one.
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
// ## Live push, shimmed
//
// The directory adapter has no `watch`, so this augments it with the same
// revision-poll shim the v1 whole-document adapter used: it polls the O(1)
// `GET /v1/rev` aggregate revision and, when it moves, re-loads through the
// directory adapter and hands the fresh snapshot to the sync engine (which
// applies it under its usual "never clobber unsaved text" guards). True server
// push (`GET /v1/events` SSE) can't ride the request/response pinned transport
// yet; see the issue tracker for the SSE-over-bridge follow-up.

import { createLogger } from "../../dev/logger.ts";
import type { AdapterCapability, StorageAdapter } from "../adapter.ts";
import type { AttachmentEntry, AttachmentStore } from "../attachment-store.ts";
import type { NotesdConfig } from "../backend-preference.ts";
import {
  type DirectoryCrypto,
  createDirectoryAdapter,
} from "../directory-adapter.ts";
import type { FileEntry, FileStore } from "../file-store.ts";
import {
  DEFAULT_NAMESPACE_SLUG,
  namespaceAttachmentsFolder,
  namespaceCloudFolder,
  namespaceNotesFolder,
} from "../namespaces.ts";
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
// switches off in favour of "only load when something actually moved".
const WATCH_POLL_INTERVAL_MS = 4000;

// Percent-encode each path segment while leaving the `/` separators intact, so a
// nested ref (`subfolder/note.md`, `stem/pic.png`) reaches the `{*path}` route
// as-is. Every segment the app produces is already `[A-Za-z0-9._-]`, so this is
// belt-and-braces rather than strictly required.
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * A `FileStore` over the daemon's blob endpoints, rooted at one namespace's
 * notes folder (`namespaceNotesFolder`). Lists the folder via
 * `GET /v1/blobs?prefix=<root>/` (the per-file etag is the revision the
 * directory adapter tracks) and moves one note's bytes at a time through
 * `/v1/blob/<root>/<path>`.
 */
function createNotesdFileStore(
  config: NotesdConfig,
  fetchImpl: FetchImpl,
  rootPath: string,
): FileStore {
  const authHeader = { Authorization: `Bearer ${config.deviceKey}` };
  const prefix = `${rootPath}/`;
  const listUrl = `${config.endpoint}/v1/blobs?prefix=${encodeURIComponent(prefix)}`;
  const blobUrl = (path: string): string =>
    `${config.endpoint}/v1/blob/${encodePath(prefix + path)}`;

  return {
    async list(): Promise<FileEntry[]> {
      const res = await fetchImpl(listUrl, {
        method: "GET",
        headers: { ...authHeader },
      });
      if (!res.ok) throw await notesdError("list", res);
      const { blobs } = (await res.json()) as {
        blobs: { path: string; etag?: string }[];
      };
      // Paths come back relative to the folder root; strip the namespace prefix
      // so the directory adapter sees notes-root-relative paths (`<stem>.md`,
      // `<folder>/<stem>.md`), the same shape the folder/cloud stores return.
      return blobs
        .filter((b) => b.path.startsWith(prefix))
        .map((b) => ({ path: b.path.slice(prefix.length), rev: b.etag }));
    },

    async read(path: string): Promise<string | null> {
      const res = await fetchImpl(blobUrl(path), {
        method: "GET",
        headers: { ...authHeader },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw await notesdError("read", res);
      return res.text();
    },

    async write(path: string, text: string): Promise<string | undefined> {
      const res = await fetchImpl(blobUrl(path), {
        method: "PUT",
        headers: { ...authHeader, "Content-Type": "application/octet-stream" },
        body: text,
      });
      if (!res.ok) throw await notesdError("write", res);
      // The daemon returns the file's new etag — exactly what `list()` reports
      // for these bytes — so the directory adapter can stamp the post-save
      // revision without an eventually-consistent re-list.
      const meta = (await res.json()) as { etag?: string };
      return meta.etag;
    },

    async remove(path: string): Promise<void> {
      const res = await fetchImpl(blobUrl(path), {
        method: "DELETE",
        headers: { ...authHeader },
      });
      if (res.status === 404) return; // already gone
      if (!res.ok) throw await notesdError("remove", res);
    },
  };
}

/**
 * An `AttachmentStore` over the daemon's blob endpoints, rooted at one
 * namespace's attachments folder (`namespaceAttachmentsFolder`). Lists with
 * `etag=0` (an attachment listing wants only paths, and shouldn't make the
 * daemon hash every image), and moves raw image bytes through
 * `/v1/blob/<root>/<path>`.
 */
function createNotesdAttachmentStore(
  config: NotesdConfig,
  fetchImpl: FetchImpl,
  rootPath: string,
): AttachmentStore {
  const authHeader = { Authorization: `Bearer ${config.deviceKey}` };
  const prefix = `${rootPath}/`;
  const listUrl = `${config.endpoint}/v1/blobs?prefix=${encodeURIComponent(prefix)}&etag=0`;
  const blobUrl = (path: string): string =>
    `${config.endpoint}/v1/blob/${encodePath(prefix + path)}`;

  return {
    async list(): Promise<AttachmentEntry[]> {
      const res = await fetchImpl(listUrl, {
        method: "GET",
        headers: { ...authHeader },
      });
      if (!res.ok) throw await notesdError("list attachments", res);
      const { blobs } = (await res.json()) as { blobs: { path: string }[] };
      return blobs
        .filter((b) => b.path.startsWith(prefix))
        .map((b) => ({ path: b.path.slice(prefix.length) }));
    },

    async read(path: string): Promise<Uint8Array | null> {
      const res = await fetchImpl(blobUrl(path), {
        method: "GET",
        headers: { ...authHeader },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw await notesdError("read attachment", res);
      return new Uint8Array(await res.arrayBuffer());
    },

    // The daemon stores raw bytes; the MIME type rides the note JSON (plaintext)
    // or the sealed blob header (encrypted), so it isn't sent on the wire here.
    async write(path: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
      const res = await fetchImpl(blobUrl(path), {
        method: "PUT",
        headers: { ...authHeader, "Content-Type": "application/octet-stream" },
        body: bytes,
      });
      if (!res.ok) throw await notesdError("write attachment", res);
    },

    async remove(path: string): Promise<void> {
      const res = await fetchImpl(blobUrl(path), {
        method: "DELETE",
        headers: { ...authHeader },
      });
      if (res.status === 404) return; // already gone
      if (!res.ok) throw await notesdError("remove attachment", res);
    },
  };
}

// The live-push shim: poll `GET /v1/rev` and, on a move, re-load through the
// directory adapter and deliver the fresh snapshot. Factored out so the adapter
// below stays a plain `createDirectoryAdapter` call with this bolted on.
function createNotesdWatch(
  config: NotesdConfig,
  fetchImpl: FetchImpl,
  inner: StorageAdapter,
): NonNullable<StorageAdapter["watch"]> {
  const revUrl = `${config.endpoint}/v1/rev`;
  const authHeader = { Authorization: `Bearer ${config.deviceKey}` };

  return (onRemoteChange) => {
    // `undefined` until the first probe seeds it — a fresh subscription never
    // delivers on its opening tick, only on a *subsequent* move, so subscribing
    // can't spuriously re-adopt what's already on screen.
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
        const res = await fetchImpl(revUrl, {
          method: "GET",
          headers: { ...authHeader },
        });
        // A transient failure (offline, 401 mid-rotation) just skips this tick;
        // the next one retries. Nothing to surface — the next save/load raises
        // anything that actually matters.
        if (!res.ok) return;
        const { rev } = (await res.json()) as { rev?: unknown };
        if (!seeded) {
          lastRev = rev;
          seeded = true;
          return;
        }
        if (rev === lastRev) return;
        lastRev = rev;
        const snapshot = await inner.load();
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
  };
}

/**
 * Build a notesd adapter for one namespace. `fetchImpl` must be an SPKI-pinned
 * fetch bound to the daemon's certificate (`createPinnedFetch(config.spkiPin)`);
 * the raw global `fetch` would fail TLS against the self-signed cert. `crypto`
 * is the injected session passphrase, threaded into the directory adapter so
 * notes and attachments are sealed per file at rest — exactly like the
 * folder/cloud backends.
 */
export function createNotesdAdapter(
  config: NotesdConfig,
  fetchImpl: FetchImpl,
  namespace: string = DEFAULT_NAMESPACE_SLUG,
  crypto?: DirectoryCrypto,
): StorageAdapter {
  log.info(`adapter created ns=${namespace}`);
  const fileStore = createNotesdFileStore(
    config,
    fetchImpl,
    namespaceNotesFolder(namespace),
  );
  const attachments = createNotesdAttachmentStore(
    config,
    fetchImpl,
    namespaceAttachmentsFolder(namespace),
  );
  const inner = createDirectoryAdapter(
    fileStore,
    {
      id: "notesd",
      label: config.name || "Self-hosted",
      saveDebounceMs: SAVE_DEBOUNCE_MS,
    },
    attachments,
    crypto,
  );

  // Bolt the revision-poll `watch` shim onto the directory adapter (which has no
  // push of its own), advertising the extra capability so the sync engine swaps
  // its whole-document live pull for "load only when the revision moves".
  return {
    ...inner,
    capabilities: new Set<AdapterCapability>([...inner.capabilities, "watch"]),
    watch: createNotesdWatch(config, fetchImpl, inner),
  };
}

// A root store (`settings.json` / `namespaces.json`) over the daemon's
// `GET/PUT /v1/settings/{name}` endpoint. The daemon reserves both names (its
// `RESERVED` / `ALLOWED_SETTINGS` lists), keeping them out of note listings, so
// appearance settings and the namespace registry sync across every paired
// device — the way they already do on the folder/cloud backends via their
// root-scoped `FileStore`. These files are app-wide plaintext JSON (theme/font
// choices and namespace names aren't secret, and stay readable behind the
// unlock gate), so unlike the note files they carry no encryption. `fetchImpl`
// must be the same SPKI-pinned fetch the adapter uses.
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
 * Delete a namespace's whole folder subtree on the daemon (every note and
 * attachment blob under `<slug>/`), so removing a namespace on this device
 * doesn't orphan its bytes on the shared daemon — the notesd counterpart of
 * {@link deleteDropboxNamespace}. The default namespace shares the folder root
 * with the settings files and has no subtree of its own, so it is never deleted.
 */
export async function deleteNotesdNamespace(
  config: NotesdConfig,
  fetchImpl: FetchImpl,
  namespace: string,
): Promise<void> {
  if (namespace === DEFAULT_NAMESPACE_SLUG) return;
  const authHeader = { Authorization: `Bearer ${config.deviceKey}` };
  const prefix = `${namespaceCloudFolder(namespace)}/`;
  const listUrl = `${config.endpoint}/v1/blobs?prefix=${encodeURIComponent(prefix)}&etag=0`;
  const res = await fetchImpl(listUrl, {
    method: "GET",
    headers: { ...authHeader },
  });
  if (!res.ok) throw await notesdError(`list ${namespace}`, res);
  const { blobs } = (await res.json()) as { blobs: { path: string }[] };
  await Promise.all(
    blobs.map(async ({ path }) => {
      const del = await fetchImpl(
        `${config.endpoint}/v1/blob/${encodePath(path)}`,
        {
          method: "DELETE",
          headers: { ...authHeader },
        },
      );
      if (del.status !== 404 && !del.ok) {
        throw await notesdError(`delete ${path}`, del);
      }
    }),
  );
}
