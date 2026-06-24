// Per-session encryption state for the directory adapter: the derived session
// keys, the memoised opaque file refs, and the per-note decrypted-JSON cache —
// everything keyed off the active passphrase. Lifted out of
// `directory-adapter.ts` so the adapter's load / save / migration paths share a
// single source of truth for key derivation and ref memoisation (the invariant
// that `attBlobPath`, `migrateNote`, and `save` derive refs from the *same*
// session keys), and so the cache-invalidation-on-passphrase-change logic is
// testable in isolation.

import {
  type SessionKeys,
  deriveRef,
  deriveSessionKeys,
  newKeyParams,
  parseKeyParams,
  serializeKeyParams,
} from "./crypto.ts";
import type { FileStore } from "./file-store.ts";

// The non-secret KDF salts for this folder's encryption, so any device with the
// passphrase derives the same keys and resolves the same opaque names.
export const KEY_PARAMS_FILE = ".keyparams.json";

// A decrypted note body cached by the encrypted note's path and the file
// revision the plaintext was unsealed from.
export type EncNoteCacheEntry = { rev: string; json: string };

export type CryptoSession = {
  // Derive (and cache) the session keys for the active passphrase, or null when
  // no passphrase is held. On a passphrase transition (lock / unlock / switch)
  // every key-derived cache is dropped and `onKeysInvalidated` fires exactly
  // once, so a caller-owned memo (the adapter's plaintext-safe load memo) can
  // be cleared in lockstep.
  ensureKeys(): Promise<SessionKeys | null>;
  // The opaque file ref for `label` + `id`, memoised within the session.
  // `deriveRef` is a keyed HMAC of the session fileKey + a stable label/id, so
  // within a session each ref is deterministic and cheap to remember — this
  // turns the per-save path computation (one HMAC per note, every save) into a
  // map lookup after the first time. Cleared whenever the keys change.
  cachedRef(keys: SessionKeys, label: string, id: string): Promise<string>;
  // Per-note decrypted-JSON cache, keyed by the encrypted note's path. Lets a
  // load skip the network read + AES-GCM open for every `.enc` file whose
  // revision hasn't moved, so a remote edit to one note re-decrypts that note
  // alone instead of the whole vault (the encrypted-mode counterpart of the
  // plaintext path's `reusableFiles`). Cleared whenever the keys change.
  encNoteCache: Map<string, EncNoteCacheEntry>;
};

export type CryptoSessionDeps = {
  store: FileStore;
  // The session passphrase, by reference so it can change at runtime (unlock /
  // enable / disable) without rebuilding the session.
  passwordRef?: { readonly current: string | null };
  // Fired once on each passphrase transition so the caller can drop its own
  // key-derived state (the adapter's plaintext-safe `lastLoad` memo, which is
  // valid across plaintext loads but must not survive a lock / unlock).
  onKeysInvalidated?: () => void;
};

export function createCryptoSession(deps: CryptoSessionDeps): CryptoSession {
  const { store, passwordRef, onKeysInvalidated } = deps;

  // Session keys, derived once per passphrase. The key-params file is read (or
  // created) the first time encryption is active, so every device shares salts.
  let keyCache: { password: string; keys: SessionKeys } | null = null;
  const refCache = new Map<string, string>();
  const encNoteCache = new Map<string, EncNoteCacheEntry>();
  // The passphrase `ensureKeys` last observed, so a change (lock / unlock /
  // switch) drops every key-derived cache exactly once on transition, not on
  // every load.
  let lastPassword: string | null = null;

  async function ensureKeys(): Promise<SessionKeys | null> {
    const password = passwordRef?.current ?? null;
    if (password !== lastPassword) {
      // Key state changed → everything derived from the old key is stale.
      refCache.clear();
      encNoteCache.clear();
      onKeysInvalidated?.();
      lastPassword = password;
    }
    if (!password) {
      keyCache = null;
      return null;
    }
    if (keyCache && keyCache.password === password) return keyCache.keys;
    let params = parseKeyParams(await store.read(KEY_PARAMS_FILE));
    if (!params) {
      params = newKeyParams();
      await store.write(KEY_PARAMS_FILE, serializeKeyParams(params));
    }
    const keys = await deriveSessionKeys(password, params);
    keyCache = { password, keys };
    return keys;
  }

  async function cachedRef(
    keys: SessionKeys,
    label: string,
    id: string,
  ): Promise<string> {
    const cacheKey = `${label} ${id}`;
    let ref = refCache.get(cacheKey);
    if (ref === undefined) {
      ref = await deriveRef(keys.fileKey, label, id);
      refCache.set(cacheKey, ref);
    }
    return ref;
  }

  return { ensureKeys, cachedRef, encNoteCache };
}
