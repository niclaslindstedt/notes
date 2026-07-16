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
import { notesdError } from "./errors.ts";

const log = createLogger("notesd");

export type FetchImpl = typeof fetch;

// Match the cloud backends' 1-second coalescing window: rapid edits within a
// gesture collapse into one network save.
const SAVE_DEBOUNCE_MS = 1000;

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

  return {
    id: "notesd",
    label: config.name || "Self-hosted",
    capabilities: new Set(),
    saveDebounceMs: SAVE_DEBOUNCE_MS,

    async load(): Promise<StoredSnapshot | null> {
      const res = await fetchImpl(url, authed({ method: "GET" }));
      if (res.status === 404) return null;
      if (!res.ok) throw await notesdError("load", res);
      const text = await res.text();
      const revision = res.headers.get("etag") ?? undefined;
      return { text, revision };
    },

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
  };
}
