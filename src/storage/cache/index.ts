// Higher-order adapter that mirrors a remote backend's bytes into a local
// cache (this device's localStorage) so the document can be read — and edited
// — while the network is unreachable (airplane mode, a dead tunnel, a captive
// portal). It sits between a cloud adapter and the encryption wrapper, so the
// cached bytes are exactly what the cloud holds: an AES-GCM envelope when
// encryption is on (the cache never sees plaintext then), or the canonical
// document JSON when it isn't.
//
// Why here and not inside each cloud adapter: the mirror logic —
// write-through on every successful load / save, fall back to the cache on a
// *network* failure, and leave the typed errors (auth / conflict / rate-limit)
// alone so their upstream handling still fires — is identical for Dropbox and
// Google Drive. So it lives once in this wrapper the way `withEncryption`
// wraps the byte boundary once.
//
// Layering (assembled in `useStorageBackend`):
//
//   cloudAdapter → withLocalCache → withEncryption → app
//
// `withLocalCache` is therefore the `inner` the unlock gate verifies the
// passphrase against — which is what lets unlocking work offline: the cached
// envelope is enough to check the passphrase and render the notes without a
// round-trip to the cloud.

import { createLogger } from "../../dev/logger.ts";
import {
  AuthError,
  ConflictError,
  RateLimitError,
  type AdapterCapability,
  type StorageAdapter,
  type StoredSnapshot,
} from "../adapter.ts";
import { DEFAULT_NAMESPACE_SLUG } from "../namespaces.ts";

const log = createLogger("cache");

// Raised by callers that need a backend round-trip but found neither the
// network nor a cached copy to fall back on — e.g. unlocking on a brand-new
// device while offline, before anything has ever been pulled down. Distinct
// so the UI can say "you're offline" instead of the misleading "wrong
// passphrase" a generic failure would map to at the unlock gate.
export class OfflineUnavailableError extends Error {
  constructor(
    message = "Backend is unreachable and nothing is cached yet",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OfflineUnavailableError";
  }
}

export type LocalCacheOptions = {
  /** Where to persist the mirror — `localStorage` in the app, a stub in tests. */
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /** Storage key, namespaced by backend id by the caller. */
  key: string;
  /**
   * Optional re-encryption of the mirror. With per-file encryption the inner
   * adapter returns *plaintext*, so to keep localStorage ciphertext-only the
   * cache seals what it writes and unseals what it reads back. `seal` wraps the
   * plaintext into one whole-document envelope; `unseal` reverses it (and is
   * what an offline unlock verifies the passphrase against). Omitted (or no
   * passphrase) → the mirror is stored as-is.
   */
  seal?: (plaintext: string) => Promise<string>;
  unseal?: (sealed: string) => Promise<string>;
};

// A failure means "serve the cache" only when it's a raw network error, never
// one of the adapter's typed signals: a `ConflictError` / `AuthError` /
// `RateLimitError` each has dedicated handling upstream, and quietly returning
// a stale cached read instead would mask it.
export function isOfflineError(err: unknown): boolean {
  if (
    err instanceof ConflictError ||
    err instanceof AuthError ||
    err instanceof RateLimitError
  ) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return true;
  }
  // `fetch` rejects with a TypeError when the request can't be made at all
  // (DNS failure, connection refused, airplane mode).
  return err instanceof TypeError;
}

type CachedBytes = { text: string; revision?: string };

/**
 * Build the per-backend, per-namespace localStorage key the cache lives
 * under. The default namespace keeps the bare `notes:cache:<backend>` key it
 * has always used; every other namespace gets a per-slug suffix so the
 * offline mirrors of different namespaces don't clobber one another.
 */
export function localCacheKey(
  backendId: string,
  namespace: string = DEFAULT_NAMESPACE_SLUG,
): string {
  return namespace === DEFAULT_NAMESPACE_SLUG
    ? `notes:cache:${backendId}`
    : `notes:cache:${backendId}:${namespace}`;
}

export function withLocalCache(
  inner: StorageAdapter,
  options: LocalCacheOptions,
): StorageAdapter {
  const { storage, key, seal, unseal } = options;

  // Seal plaintext into the mirror format (or pass through when no seal is
  // wired). Best-effort: if sealing throws we'd rather skip caching than crash a
  // successful load/save, so callers guard the write.
  async function sealForCache(plaintext: string): Promise<string> {
    return seal ? await seal(plaintext) : plaintext;
  }

  // Reverse the seal; tolerate already-plaintext bytes (a mirror written before
  // encryption was enabled, or no seal wired).
  async function unsealFromCache(stored: string): Promise<string> {
    return unseal ? await unseal(stored) : stored;
  }

  function readCache(): CachedBytes | null {
    try {
      const raw = storage.getItem(key);
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as CachedBytes;
      if (typeof parsed?.text !== "string") return null;
      return parsed;
    } catch (err) {
      log.warn("readCache failed", err);
      return null;
    }
  }

  function writeCache(value: CachedBytes): void {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (err) {
      log.warn("writeCache failed", err);
    }
  }

  function clearCache(): void {
    try {
      storage.removeItem(key);
    } catch (err) {
      log.warn("clearCache failed", err);
    }
  }

  // Forward the inner capabilities verbatim. The cache could answer a
  // synchronous read, but a live load is always preferred over a possibly
  // stale mirror, and the cloud adapters carry no `loadSync` anyway.
  const capabilities = new Set<AdapterCapability>(inner.capabilities);

  return {
    id: inner.id,
    label: inner.label,
    saveDebounceMs: inner.saveDebounceMs,
    capabilities,
    getRevision: inner.getRevision ? () => inner.getRevision!() : undefined,

    async load(): Promise<StoredSnapshot | null> {
      try {
        // Hand the inner backend our cached copy (unsealed) so a file-per-note
        // backend can fetch only the notes whose revision moved instead of
        // re-reading the whole folder — the read half of keeping a large note
        // set in sync.
        let previous: StoredSnapshot | undefined;
        const cached = readCache();
        if (cached) {
          try {
            previous = { ...cached, text: await unsealFromCache(cached.text) };
          } catch {
            // A mirror we can't unseal (no key yet) is no use as a reuse hint.
            previous = undefined;
          }
        }
        const snap = await inner.load(previous);
        if (snap) {
          try {
            writeCache({
              text: await sealForCache(snap.text),
              revision: snap.revision,
            });
          } catch (err) {
            log.warn("load: sealing cache failed — skipping mirror", err);
          }
        } else {
          // The remote genuinely has nothing — drop any stale mirror so an
          // offline read can't resurrect a document that was deleted.
          clearCache();
        }
        return snap;
      } catch (err) {
        if (isOfflineError(err)) {
          const cached = readCache();
          if (cached) {
            log.info("load: backend offline — serving cached copy");
            return {
              ...cached,
              text: await unsealFromCache(cached.text),
              offline: true,
            };
          }
          log.warn("load: backend offline and no cached copy");
        }
        // Either a real (typed) error, or offline with an empty cache. Let
        // the caller decide — `useStorageBackend.unlock` maps the latter to a
        // distinct "you're offline" message.
        throw err;
      }
    },

    async save(text: string, baseRevision?: string): Promise<StoredSnapshot> {
      try {
        const stored = await inner.save(text, baseRevision);
        try {
          writeCache({
            text: await sealForCache(stored.text),
            revision: stored.revision,
          });
        } catch (err) {
          log.warn("save: sealing cache failed — skipping mirror", err);
        }
        return stored;
      } catch (err) {
        if (isOfflineError(err)) {
          // Persist the attempted bytes locally (sealed) so the edit survives
          // an offline reload; keep the last good revision so the eventual
          // reconnect save bases on the right baseline. Re-throw so the sync
          // engine keeps the edit queued and retries it when the network
          // returns (see the `online` listener in `use-notes-sync`).
          try {
            writeCache({
              text: await sealForCache(text),
              revision: readCache()?.revision,
            });
          } catch {
            // Couldn't seal the offline edit — drop the mirror update rather
            // than write plaintext.
          }
          log.info("save: backend offline — cached locally, will retry");
        }
        throw err;
      }
    },

    watch: inner.watch ? (cb) => inner.watch!(cb) : undefined,

    fetchAttachment: inner.fetchAttachment
      ? (note, filename) => inner.fetchAttachment!(note, filename)
      : undefined,

    getEncryptionStatus: inner.getEncryptionStatus
      ? () => inner.getEncryptionStatus!()
      : undefined,

    migrateNote: inner.migrateNote
      ? (note) => inner.migrateNote!(note)
      : undefined,

    splitLegacyBlob: inner.splitLegacyBlob
      ? () => inner.splitLegacyBlob!()
      : undefined,
  };
}
