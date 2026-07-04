// The at-rest encryption concern of the storage backend, extracted from
// `useStorageBackend` into a self-contained state machine: the session
// passphrase, the encryption mode, the locked / disabling flags, the per-file
// `directoryCrypto` ref bundle the directory adapters read at call time, the
// offline-cache `seal` / `unseal`, and the four enable / disable / finish /
// unlock verbs.
//
// There are no user accounts, so the passphrase isn't derived from a login —
// it's set explicitly in Settings and held only in memory for the session.
// After a reload the app is "locked" (encryption is on but no passphrase is
// held) until the user re-enters it; the `locked` flag drives the unlock gate
// in `App`.
//
// The verbs need the active document adapter, which is built *from* this hook's
// `directoryCrypto` / `seal` / `unseal` outputs — a render-order cycle. It is
// broken by handing in a ref to the adapter (`innerRef`) the verbs read at call
// time, long after the adapter has been built.

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
import { OfflineUnavailableError } from "./cache/index.ts";
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
  /** The per-file crypto bundle the directory adapters read at call time. */
  directoryCrypto: DirectoryCrypto;
  /** Seal a plaintext for the offline cache when a passphrase is held. */
  seal: (plaintext: string) => Promise<string>;
  /** Unseal a cached envelope when a passphrase is held; pass-through otherwise. */
  unseal: (stored: string) => Promise<string>;
  /** The session passphrase ref the whole-document `withEncryption` wrapper reads. */
  passwordRef: PasswordRef;
  /** Encryption mode and whether a passphrase is held this session. */
  encryption: EncryptionMode;
  /** True when encryption is on but no passphrase is held yet (needs unlock). */
  locked: boolean;
  /** True while a file/cloud backend's background de-encryption queue drains. */
  disabling: boolean;
  /**
   * Wrap a single-document adapter (the browser store) in the session's
   * whole-document encryption envelope so a folder seed / mirror round-trips the
   * same bytes the steady-state app does. A no-op when encryption is off.
   */
  wrapBrowserForActive: (raw: StorageAdapter) => StorageAdapter;
  enableEncryption: (
    next: string,
    onProgress?: EncryptionProgress,
  ) => Promise<void>;
  disableEncryption: (onProgress?: EncryptionProgress) => Promise<void>;
  finishDisableEncryption: () => void;
  unlock: (candidate: string, onProgress?: EncryptionProgress) => Promise<void>;
}

export function useEncryption(
  innerRef: { readonly current: StorageAdapter | null },
  backend: BackendId,
): UseEncryption {
  const [encryption, setEncryptionState] =
    useState<EncryptionMode>(getEncryption);
  // File/cloud only: true while the background de-encryption queue drains. The
  // mode stays `encrypted` (and the passphrase held) until the last note is
  // plaintext, then `finishDisableEncryption` flips it.
  const [disabling, setDisabling] = useState(false);
  // Session-only passphrase. Never persisted — lost on reload by design.
  const [password, setPassword] = useState<string | null>(null);
  // A stable ref the per-file directory adapters read at call time, so the
  // adapter never needs rebuilding when the passphrase changes (unlock / enable
  // / disable). Kept in lockstep with the `password` state via `applyPassword`.
  const passwordRef = useRef<string | null>(null);
  // Points at the unlock gate's status callback only while an unlock is in
  // flight, so the directory adapter can report each note as it decrypts it.
  // Null the rest of the time — a steady-state load reports nothing.
  const decryptNoteRef = useRef<DecryptNoteReporter | null>(null);
  const directoryCrypto = useMemo<DirectoryCrypto>(
    () => ({ passwordRef, onDecryptNote: decryptNoteRef }),
    [],
  );
  // Set or clear the session passphrase in one place: the imperative ref (read
  // by the adapters) and the React state (drives `locked` / re-renders).
  const applyPassword = useCallback((next: string | null) => {
    passwordRef.current = next;
    setPassword(next);
  }, []);

  // Seal/unseal the offline cache so localStorage holds one whole-document
  // envelope (ciphertext) even though the per-file directory adapter hands the
  // cache plaintext. No passphrase held → pass through. `unseal` is what an
  // offline unlock verifies the candidate passphrase against.
  const seal = useCallback(async (plaintext: string): Promise<string> => {
    const pw = passwordRef.current;
    return pw ? await encryptText(plaintext, pw) : plaintext;
  }, []);
  const unseal = useCallback(async (stored: string): Promise<string> => {
    const pw = passwordRef.current;
    return pw && isEncryptedEnvelope(stored)
      ? await decryptEnvelope(stored, pw)
      : stored;
  }, []);

  const locked = encryption === "encrypted" && password === null;

  const wrapBrowserForActive = useCallback(
    (raw: StorageAdapter): StorageAdapter =>
      encryption === "encrypted" && password !== null
        ? withEncryption(raw, passwordRef)
        : raw,
    [encryption, password],
  );

  const enableEncryption = useCallback(
    async (next: string, onProgress?: EncryptionProgress) => {
      if (!next) throw new Error("Passphrase is required");
      // Always built before any verb can fire (the verbs are wired to UI that
      // mounts after the adapter exists); guarded only for type-safety.
      const inner = innerRef.current;
      if (!inner) return;
      log.info("enable encryption: start");
      // The browser backend has no per-note representation: its whole document
      // is one envelope, so the switch is a single re-save through the
      // `withEncryption` wrapper here and now.
      if (backend === "browser") {
        onProgress?.("reading");
        const snap = await inner.load();
        const hydrated = snap ? await hydrateForSwitch(inner, snap.text) : null;
        onProgress?.("derivingKey");
        passwordRef.current = next;
        if (snap && hydrated !== null) {
          onProgress?.("encrypting");
          onProgress?.("saving");
          // Re-save **through the encryption wrapper** so the existing document
          // lands as ciphertext at rest now — a raw `inner.save` here would leave
          // it in plaintext (despite the mode reading "encrypted") until the next
          // edit happened to go through the wrapped app adapter.
          await withEncryption(inner, passwordRef).save(
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
        passwordRef.current = next;
      }
      persistEncryption("encrypted");
      setEncryptionState("encrypted");
      applyPassword(next);
      log.info("enable encryption: mode on");
      unlockAchievement("paranoidMode");
    },
    [backend, applyPassword, innerRef],
  );

  const disableEncryption = useCallback(
    async (onProgress?: EncryptionProgress) => {
      if (passwordRef.current === null) {
        throw new Error("Unlock before turning encryption off");
      }
      const inner = innerRef.current;
      if (!inner) return;
      log.info("disable encryption: start");
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
        const encrypted = withEncryption(inner, passwordRef);
        const snap = await encrypted.load();
        const hydrated = snap
          ? await hydrateForSwitch(encrypted, snap.text)
          : null;
        passwordRef.current = null;
        if (snap && hydrated !== null) {
          onProgress?.("saving");
          await inner.save(hydrated, snap.revision);
        }
        onProgress?.("finalizing");
        persistEncryption("plaintext");
        setEncryptionState("plaintext");
        applyPassword(null);
        log.info("disable encryption: done");
        return;
      }
      // File/cloud: keep the mode `encrypted` and the passphrase held, and raise
      // the flag so the background queue decrypts note-by-note. It calls
      // `finishDisableEncryption` once the last note is plaintext.
      setDisabling(true);
    },
    [backend, applyPassword, innerRef],
  );

  const finishDisableEncryption = useCallback(() => {
    log.info("disable encryption: queue drained — finalising");
    persistEncryption("plaintext");
    setEncryptionState("plaintext");
    applyPassword(null);
    setDisabling(false);
  }, [applyPassword]);

  const unlock = useCallback(
    async (candidate: string, onProgress?: EncryptionProgress) => {
      if (!candidate) throw new Error("Passphrase is required");
      const inner = innerRef.current;
      if (!inner) return;
      // Tentatively activate the candidate so the directory adapter derives keys
      // and decrypts the per-file notes (or the offline cache falls back and
      // unseals against it). A wrong passphrase surfaces as an AES-GCM auth
      // failure ("Wrong password"); an unreachable backend with nothing cached
      // maps to the distinct "you're offline" error.
      // The phases bracket the single `inner.load()` that does the real work
      // (derive key → read → decrypt) so the unlock gate can flash what's
      // happening instead of sitting blank.
      onProgress?.("derivingKey");
      const previous = passwordRef.current;
      passwordRef.current = candidate;
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
        passwordRef.current = previous;
        if (err instanceof Error && /wrong password/i.test(err.message)) {
          throw new Error("Wrong password", { cause: err });
        }
        log.warn("unlock: backend unreachable and no cached copy", err);
        throw new OfflineUnavailableError(undefined, { cause: err });
      } finally {
        decryptNoteRef.current = null;
      }
      onProgress?.("finalizing");
      applyPassword(candidate);
    },
    [innerRef, applyPassword],
  );

  return {
    directoryCrypto,
    seal,
    unseal,
    passwordRef,
    encryption,
    locked,
    disabling,
    wrapBrowserForActive,
    enableEncryption,
    disableEncryption,
    finishDisableEncryption,
    unlock,
  };
}
