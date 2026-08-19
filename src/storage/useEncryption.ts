// The at-rest encryption concern of the storage backend, as a self-contained
// state machine: the session passphrases, the per-namespace encryption modes,
// the locked / disabling flags, the per-file `DirectoryCrypto` bundles the
// directory adapters read at call time, the offline-cache `seal` / `unseal`,
// and the four enable / disable / finish / unlock verbs.
//
// **Encryption is per namespace.** A namespace is a bucket several people can
// share through one login and one folder, so the decision to seal one is a
// decision about that bucket alone: sealing the namespace you keep your own
// things in must not seal the one you share with four other people, and — the
// half that actually bites — a namespace *they* sealed must not lock you out
// of yours. So every piece of state below is keyed by slug: the mode, the
// passphrase, the "why am I locked" hint, the drain flag. `locked` is only
// ever a statement about the namespace currently open, and switching to
// another namespace is a way *out* of a lock rather than a thing the lock
// prevents (see the unlock gate).
//
// There are no user accounts, so a passphrase isn't derived from a login —
// it's set explicitly in Settings and held only in memory for the session.
// After a reload every encrypted namespace is locked again until its
// passphrase is re-entered.
//
// The verbs need the active document adapter, which is built *from* this
// hook's `cryptoFor` / `sealFor` / `unsealFor` outputs — a render-order cycle.
// It is broken by handing in a ref to the adapter (`innerRef`) the verbs read
// at call time, long after the adapter has been built.

import { useCallback, useMemo, useRef, useState } from "react";

// Aliased: this module has a passphrase `unlock` verb of its own.
import { unlock as unlockAchievement } from "../achievements/index.ts";
import { createLogger } from "../dev/logger.ts";
import type { StorageAdapter } from "./adapter.ts";
import { bytesToDataUrl } from "./attachment-store.ts";
import {
  type BackendId,
  type EncryptionMode,
  getEncryption,
  setEncryption as persistEncryption,
} from "./backend-preference.ts";
import { OfflineUnavailableError } from "./cache/offline-error.ts";
import { decryptEnvelope, encryptText, isEncryptedEnvelope } from "./crypto.ts";
import type {
  DecryptNoteReporter,
  DirectoryCrypto,
} from "./directory-adapter.ts";
import type { PasswordRef } from "./encrypting/index.ts";
import { withEncryption } from "./encrypting/index.ts";
import { parse, serialize } from "./serialize.ts";

const log = createLogger("storage");

// The ordered phases turning encryption on/off passes through, surfaced to the
// settings UI so it can flash a one-line status while the work runs. `reading`,
// `saving`, and `finalizing` bracket the storage round-trip; the key-derivation
// and cipher phases (`derivingKey` / `encrypting` / `decrypting`) bubble up from
// the crypto layer — the superset keeps a single callback driving both.
export type EncryptionProgressStep =
  | "reading"
  | "derivingKey"
  | "encrypting"
  | "decrypting"
  | "saving"
  | "finalizing";
// Optional per-note context a phase can carry — only the `decrypting` phase of
// an unlock fills it in, once per note as the file/cloud backend unseals them in
// sequence, so the status line can name the note being decrypted (and how far
// through the run it is) instead of a single undifferentiated wait.
export type EncryptionProgressDetail = {
  title: string;
  index: number;
  total: number;
};
export type EncryptionProgress = (
  step: EncryptionProgressStep,
  detail?: EncryptionProgressDetail,
) => void;

// Pull every attachment's bytes into the snapshot before a representation
// switch. A note loads metadata-only (bytes fetched on demand), but a switch
// has to *move* the bytes from the old representation to the new one — so they
// must be in hand while the old representation is still readable (keys still
// in their pre-flip state). Without this, the switch would clear the old
// attachment files with nothing written in their place. The migration queue
// does this incrementally per attachment; the toggle does it in one pass.
export async function hydrateForSwitch(
  inner: StorageAdapter,
  text: string,
): Promise<string> {
  const snap = parse(text);
  for (const note of snap.notes) {
    for (const a of note.attachments ?? []) {
      if (a.data) continue;
      const got = await inner.fetchAttachment?.(note, a.filename);
      if (got) a.data = bytesToDataUrl(got.mime, got.bytes);
    }
  }
  return serialize(snap);
}

export interface UseEncryption {
  /**
   * The per-file crypto bundle a namespace's directory adapter reads at call
   * time. Stable per slug, so building the adapter for a namespace twice
   * doesn't invalidate its memo.
   */
  cryptoFor: (namespace: string) => DirectoryCrypto;
  /** Seal a plaintext for a namespace's offline cache when its passphrase is held. */
  sealFor: (namespace: string) => (plaintext: string) => Promise<string>;
  /** Unseal a namespace's cache envelope when its passphrase is held. */
  unsealFor: (namespace: string) => (stored: string) => Promise<string>;
  /** A namespace's session passphrase ref, for the whole-document wrapper. */
  passwordRefFor: (namespace: string) => PasswordRef;
  /** The active namespace's encryption mode. */
  encryption: EncryptionMode;
  /** True when the **active** namespace is encrypted and holds no passphrase. */
  locked: boolean;
  /** Whether a given namespace is sealed and un-opened this session. */
  isNamespaceLocked: (namespace: string) => boolean;
  /** Every namespace this device knows to be encrypted, whether opened or not. */
  isNamespaceEncrypted: (namespace: string) => boolean;
  /** True while the active namespace's background de-encryption queue drains. */
  disabling: boolean;
  /**
   * True when the active namespace's locked state was triggered by discovering
   * it is encrypted (someone else turned encryption on), rather than a plain
   * reload of a namespace this device already knew was sealed. Lets the unlock
   * gate explain *why* it appeared. Reset once unlocked.
   */
  fromRemote: boolean;
  /**
   * Wrap a single-document adapter (the browser store) for one namespace in
   * that namespace's whole-document encryption envelope, so a folder seed /
   * mirror round-trips the same bytes the steady-state app does. A no-op when
   * that namespace isn't encrypted or holds no passphrase.
   */
  wrapBrowserFor: (namespace: string, raw: StorageAdapter) => StorageAdapter;
  enableEncryption: (
    next: string,
    onProgress?: EncryptionProgress,
  ) => Promise<void>;
  disableEncryption: (onProgress?: EncryptionProgress) => Promise<void>;
  finishDisableEncryption: () => void;
  unlock: (candidate: string, onProgress?: EncryptionProgress) => Promise<void>;
  /**
   * Adopt an encrypted namespace discovered on load: flip *that namespace's*
   * mode to `encrypted` without a passphrase so `locked` goes true and the
   * unlock gate appears. Idempotent — a no-op once already encrypted. This is
   * how encryption turned on from one device is enforced on every device that
   * syncs the same namespace folder.
   */
  adoptEncryptedRemote: () => void;
}

export function useEncryption(
  innerRef: { readonly current: StorageAdapter | null },
  backend: BackendId,
  activeNamespace: string,
): UseEncryption {
  // Session-only passphrases, one per namespace. Never persisted — lost on
  // reload by design. Held in a ref so the directory adapters can read them at
  // call time without the adapter being rebuilt on every unlock; `epoch` is
  // what turns a mutation into a re-render.
  const passwords = useRef(new Map<string, string>());
  const [passwordEpoch, setPasswordEpoch] = useState(0);
  // Bumped whenever a namespace's persisted mode changes, so the derived
  // `encryption` below re-reads it.
  const [modeEpoch, setModeEpoch] = useState(0);
  // File/cloud only: the namespace whose background de-encryption queue is
  // draining. Its mode stays `encrypted` (and its passphrase held) until the
  // last note is plaintext, then `finishDisableEncryption` flips it.
  const [disablingSlug, setDisablingSlug] = useState<string | null>(null);
  // The namespace whose locked state came from discovering it is encrypted
  // (someone else enabled it) rather than a plain reload. Drives the unlock
  // gate's copy; cleared once that namespace's passphrase lands.
  const [fromRemoteSlug, setFromRemoteSlug] = useState<string | null>(null);

  // Points at the unlock gate's status callback only while an unlock is in
  // flight, so the directory adapter can report each note as it decrypts it.
  // Null the rest of the time — a steady-state load reports nothing. One
  // shared ref: only one unlock can be in flight at a time.
  const decryptNoteRef = useRef<DecryptNoteReporter | null>(null);

  // One stable `DirectoryCrypto` per namespace. Its `passwordRef` is a live
  // view onto that slug's entry in the map, so unlocking a namespace does not
  // rebuild its adapter — and, just as importantly, a namespace whose
  // passphrase is not held reads `null` and stays sealed.
  const cryptoBySlug = useRef(new Map<string, DirectoryCrypto>());
  const cryptoFor = useCallback((namespace: string): DirectoryCrypto => {
    const existing = cryptoBySlug.current.get(namespace);
    if (existing) return existing;
    const made: DirectoryCrypto = {
      passwordRef: {
        get current(): string | null {
          return passwords.current.get(namespace) ?? null;
        },
      },
      onDecryptNote: decryptNoteRef,
    };
    cryptoBySlug.current.set(namespace, made);
    return made;
  }, []);

  const passwordRefFor = useCallback(
    (namespace: string): PasswordRef => cryptoFor(namespace).passwordRef,
    [cryptoFor],
  );

  // Seal/unseal a namespace's offline cache so localStorage holds one whole-
  // document envelope (ciphertext) even though the per-file directory adapter
  // hands the cache plaintext. No passphrase held → pass through. `unseal` is
  // what an offline unlock verifies the candidate passphrase against. Memoised
  // per slug so the cache wrapper's identity is stable across renders.
  const cacheCrypto = useRef(
    new Map<
      string,
      {
        seal: (plaintext: string) => Promise<string>;
        unseal: (stored: string) => Promise<string>;
      }
    >(),
  );
  const cacheCryptoFor = useCallback((namespace: string) => {
    const existing = cacheCrypto.current.get(namespace);
    if (existing) return existing;
    const made = {
      seal: async (plaintext: string): Promise<string> => {
        const pw = passwords.current.get(namespace);
        return pw ? await encryptText(plaintext, pw) : plaintext;
      },
      unseal: async (stored: string): Promise<string> => {
        const pw = passwords.current.get(namespace);
        return pw && isEncryptedEnvelope(stored)
          ? await decryptEnvelope(stored, pw)
          : stored;
      },
    };
    cacheCrypto.current.set(namespace, made);
    return made;
  }, []);
  const sealFor = useCallback(
    (namespace: string) => cacheCryptoFor(namespace).seal,
    [cacheCryptoFor],
  );
  const unsealFor = useCallback(
    (namespace: string) => cacheCryptoFor(namespace).unseal,
    [cacheCryptoFor],
  );

  // Set or clear one namespace's session passphrase: the imperative map (read
  // by the adapters) and the epoch (drives `locked` / re-renders).
  const applyPassword = useCallback(
    (namespace: string, next: string | null) => {
      if (next === null) passwords.current.delete(namespace);
      else passwords.current.set(namespace, next);
      setPasswordEpoch((n) => n + 1);
      // A passphrase landing (unlock) clears the "why am I locked" hint for
      // that namespace — the next lock decides its own reason.
      if (next !== null) {
        setFromRemoteSlug((slug) => (slug === namespace ? null : slug));
      }
    },
    [],
  );

  const isNamespaceEncrypted = useCallback(
    (namespace: string): boolean => {
      void modeEpoch;
      return getEncryption(namespace) === "encrypted";
    },
    [modeEpoch],
  );

  const isNamespaceLocked = useCallback(
    (namespace: string): boolean => {
      void passwordEpoch;
      return (
        isNamespaceEncrypted(namespace) && !passwords.current.has(namespace)
      );
    },
    [isNamespaceEncrypted, passwordEpoch],
  );

  const encryption = useMemo<EncryptionMode>(() => {
    void modeEpoch;
    return getEncryption(activeNamespace);
  }, [activeNamespace, modeEpoch]);

  const locked = isNamespaceLocked(activeNamespace);
  const disabling = disablingSlug === activeNamespace;
  const fromRemote = fromRemoteSlug === activeNamespace;

  const wrapBrowserFor = useCallback(
    (namespace: string, raw: StorageAdapter): StorageAdapter => {
      void passwordEpoch;
      void modeEpoch;
      return getEncryption(namespace) === "encrypted" &&
        passwords.current.has(namespace)
        ? withEncryption(raw, passwordRefFor(namespace))
        : raw;
    },
    [passwordRefFor, passwordEpoch, modeEpoch],
  );

  const enableEncryption = useCallback(
    async (next: string, onProgress?: EncryptionProgress) => {
      if (!next) throw new Error("Passphrase is required");
      // Always built before any verb can fire (the verbs are wired to UI that
      // mounts after the adapter exists); guarded only for type-safety.
      const inner = innerRef.current;
      if (!inner) return;
      const namespace = activeNamespace;
      log.info(`enable encryption: start ns=${namespace}`);
      // The browser backend has no per-note representation: its whole document
      // is one envelope, so the switch is a single re-save through the
      // `withEncryption` wrapper here and now.
      if (backend === "browser") {
        onProgress?.("reading");
        const snap = await inner.load();
        const hydrated = snap ? await hydrateForSwitch(inner, snap.text) : null;
        onProgress?.("derivingKey");
        passwords.current.set(namespace, next);
        if (snap && hydrated !== null) {
          onProgress?.("encrypting");
          onProgress?.("saving");
          // Re-save **through the encryption wrapper** so the existing document
          // lands as ciphertext at rest now — a raw `inner.save` here would leave
          // it in plaintext (despite the mode reading "encrypted") until the next
          // edit happened to go through the wrapped app adapter.
          await withEncryption(inner, passwordRefFor(namespace)).save(
            hydrated,
            snap.revision,
          );
        }
        onProgress?.("finalizing");
      } else {
        // File/cloud: flip the mode immediately and let the background queue
        // seal each note one at a time (the encrypted load merges any
        // not-yet-sealed plaintext remnant, so the document stays whole). No
        // bulk re-save here — that would burst the cloud API and block the UI.
        onProgress?.("derivingKey");
        passwords.current.set(namespace, next);
      }
      persistEncryption(namespace, "encrypted");
      setModeEpoch((n) => n + 1);
      applyPassword(namespace, next);
      log.info(`enable encryption: mode on ns=${namespace}`);
      unlockAchievement("paranoidMode");
    },
    [backend, applyPassword, innerRef, activeNamespace, passwordRefFor],
  );

  const disableEncryption = useCallback(
    async (onProgress?: EncryptionProgress) => {
      const namespace = activeNamespace;
      if (!passwords.current.has(namespace)) {
        throw new Error("Unlock before turning encryption off");
      }
      const inner = innerRef.current;
      if (!inner) return;
      log.info(`disable encryption: start ns=${namespace}`);
      if (backend === "browser") {
        // Whole-document backend: read + decrypt and re-save as plaintext in one
        // pass, clearing the encrypted bytes only after the plaintext is written.
        // The document lives in localStorage as one encrypted envelope, so the
        // read must go **through the encryption wrapper** (which decrypts while
        // the passphrase is still held) — reading the raw `inner` here would hand
        // `hydrateForSwitch` the ciphertext, which parses to an empty document
        // and then overwrites the notes with nothing. A plaintext leftover (mode
        // was on but nothing was encrypted yet) passes straight through.
        onProgress?.("reading");
        onProgress?.("decrypting");
        const encrypted = withEncryption(inner, passwordRefFor(namespace));
        const snap = await encrypted.load();
        const hydrated = snap
          ? await hydrateForSwitch(encrypted, snap.text)
          : null;
        passwords.current.delete(namespace);
        if (snap && hydrated !== null) {
          onProgress?.("saving");
          await inner.save(hydrated, snap.revision);
        }
        onProgress?.("finalizing");
        persistEncryption(namespace, "plaintext");
        setModeEpoch((n) => n + 1);
        applyPassword(namespace, null);
        log.info(`disable encryption: done ns=${namespace}`);
        return;
      }
      // File/cloud: keep the mode `encrypted` and the passphrase held, and raise
      // the flag so the background queue decrypts note-by-note. It calls
      // `finishDisableEncryption` once the last note is plaintext.
      setDisablingSlug(namespace);
    },
    [backend, applyPassword, innerRef, activeNamespace, passwordRefFor],
  );

  const adoptEncryptedRemote = useCallback(() => {
    const namespace = activeNamespace;
    // Already encrypted (or unlocked this session) — nothing to adopt.
    if (
      getEncryption(namespace) === "encrypted" ||
      passwords.current.has(namespace)
    ) {
      return;
    }
    log.info(
      `adopt: ns=${namespace} is encrypted — locking for the passphrase`,
    );
    persistEncryption(namespace, "encrypted");
    setModeEpoch((n) => n + 1);
    setFromRemoteSlug(namespace);
    // No passphrase held → `locked` becomes true → the unlock gate shows.
    unlockAchievement("keyHandoff");
  }, [activeNamespace]);

  const finishDisableEncryption = useCallback(() => {
    const namespace = activeNamespace;
    log.info(`disable encryption: queue drained ns=${namespace} — finalising`);
    persistEncryption(namespace, "plaintext");
    setModeEpoch((n) => n + 1);
    applyPassword(namespace, null);
    setDisablingSlug((slug) => (slug === namespace ? null : slug));
  }, [applyPassword, activeNamespace]);

  const unlock = useCallback(
    async (candidate: string, onProgress?: EncryptionProgress) => {
      if (!candidate) throw new Error("Passphrase is required");
      const inner = innerRef.current;
      if (!inner) return;
      const namespace = activeNamespace;
      // Tentatively activate the candidate so the directory adapter derives keys
      // and decrypts the per-file notes (or the offline cache falls back and
      // unseals against it). A wrong passphrase surfaces as an AES-GCM auth
      // failure ("Wrong password"); an unreachable backend with nothing cached
      // maps to the distinct "you're offline" error.
      // The phases bracket the single `inner.load()` that does the real work
      // (derive key → read → decrypt) so the unlock gate can flash what's
      // happening instead of sitting blank.
      onProgress?.("derivingKey");
      const previous = passwords.current.get(namespace) ?? null;
      passwords.current.set(namespace, candidate);
      // Forward each note the file/cloud backend unseals to the status line, so
      // a long decrypt names the note it's on. Cleared in `finally` so it never
      // fires for a steady-state load. The browser backend decrypts one whole
      // envelope (no per-note events), so it just keeps the generic phase line.
      decryptNoteRef.current = onProgress
        ? (info) => onProgress("decrypting", info)
        : null;
      try {
        onProgress?.("decrypting");
        await inner.load();
      } catch (err) {
        if (previous === null) passwords.current.delete(namespace);
        else passwords.current.set(namespace, previous);
        if (err instanceof Error && /wrong password/i.test(err.message)) {
          throw new Error("Wrong password", { cause: err });
        }
        log.warn("unlock: backend unreachable and no cached copy", err);
        throw new OfflineUnavailableError(undefined, { cause: err });
      } finally {
        decryptNoteRef.current = null;
      }
      onProgress?.("finalizing");
      applyPassword(namespace, candidate);
    },
    [innerRef, applyPassword, activeNamespace],
  );

  return {
    cryptoFor,
    sealFor,
    unsealFor,
    passwordRefFor,
    encryption,
    locked,
    isNamespaceLocked,
    isNamespaceEncrypted,
    disabling,
    fromRemote,
    wrapBrowserFor,
    enableEncryption,
    disableEncryption,
    finishDisableEncryption,
    unlock,
    adoptEncryptedRemote,
  };
}
