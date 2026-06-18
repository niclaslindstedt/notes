// Higher-order adapter that wraps any `StorageAdapter` and applies
// password-based encryption at the byte boundary. The underlying adapter
// still sees opaque bytes, so the same wrapper works whether the bytes
// ultimately live in localStorage, a Dropbox app folder, or a Google Drive
// file.
//
// The password is held by reference so it can change at runtime (enable /
// disable encryption from settings) without re-creating the adapter. A null
// `passwordRef.current` means "pass through" — useful for the transitional
// window after the user enables encryption but before the imperative re-wrap
// of existing storage has run.

import { createLogger } from "../../dev/logger.ts";
import type {
  AdapterCapability,
  StorageAdapter,
  StoredSnapshot,
} from "../adapter.ts";
import {
  decryptEnvelope,
  encryptText,
  isEncryptedEnvelope,
} from "../crypto.ts";

const log = createLogger("encrypt");

export type PasswordRef = { readonly current: string | null };

export function withEncryption(
  inner: StorageAdapter,
  passwordRef: PasswordRef,
): StorageAdapter {
  // Forward every inner capability except `loadSync` — decryption is async
  // even when the inner backend can serve bytes synchronously, so this
  // wrapper never implements the sync fast path.
  const capabilities = new Set<AdapterCapability>(inner.capabilities);
  capabilities.delete("loadSync");

  return {
    id: inner.id,
    label: `${inner.label} (encrypted)`,
    saveDebounceMs: inner.saveDebounceMs,
    capabilities,

    getRevision: inner.getRevision ? () => inner.getRevision!() : undefined,

    async load(): Promise<StoredSnapshot | null> {
      const snap = await inner.load();
      if (!snap) return null;
      if (!isEncryptedEnvelope(snap.text)) {
        // Plaintext leftover (e.g. encryption was just enabled and the
        // imperative re-wrap hasn't run yet) — hand it back as-is so the
        // document survives the transition.
        return snap;
      }
      const password = passwordRef.current;
      if (!password) {
        log.error("load: encrypted envelope but no password available");
        throw new Error("Storage is encrypted; password is required");
      }
      const text = await decryptEnvelope(snap.text, password);
      return { ...snap, text };
    },

    async save(text: string, baseRevision?: string): Promise<StoredSnapshot> {
      const password = passwordRef.current;
      const payload = password ? await encryptText(text, password) : text;
      const written = await inner.save(payload, baseRevision);
      // The caller compares revisions, not bytes, so it's safe to hand back
      // the plaintext alongside the revision the inner adapter produced for
      // the ciphertext.
      return { ...written, text };
    },

    watch: inner.watch
      ? (onRemoteChange) =>
          inner.watch!((snap) => {
            if (!isEncryptedEnvelope(snap.text)) {
              onRemoteChange(snap);
              return;
            }
            const password = passwordRef.current;
            if (!password) {
              log.warn("watch: remote encrypted but no password — dropping");
              return;
            }
            decryptEnvelope(snap.text, password)
              .then((text) => onRemoteChange({ ...snap, text }))
              .catch((err) => log.error("watch: decrypt failed", err));
          })
      : undefined,
  };
}
