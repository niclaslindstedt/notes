// The plain↔encrypted per-note migration converters for the directory adapter.
//
// Enabling encryption hands the app `migrateNote` (plaintext `.md` → encrypted
// `.enc` + opaque attachment blobs); disabling it hands back `demigrateNote`
// (the exact reverse); and a one-time `splitLegacyBlob` upgrades an old
// whole-document `notes.json` envelope into the per-file encrypted form. All
// three are the unit the paced (de)encryption queue drives, so a large vault
// converts one note at a time without bursting the cloud API.
//
// These were lifted out of `createDirectoryAdapter`'s closure verbatim; they
// reach back into the adapter only through the explicit `deps` bundle below
// (the crypto session, the ref derivers, the revision tracker, the encryption
// status map, the stores, and — for the legacy split — `save` itself), so the
// byte-level behaviour is unchanged. The pure codecs they rely on
// (`noteToEncJson` / `encJsonToNote`) live in `enc-note-codec.ts`, which is what
// guarantees the encrypted-note encoding here is identical to `save`'s.
//
// ## Atomicity — no data loss across a representation switch
//
// Plaintext and encrypted files live at *different, deterministic* paths, so
// each converter is write-new → verify-by-readback → delete-old: the new
// representation is written and re-read to confirm it committed and decrypts,
// and only then is the superseded one removed. A crash between the two leaves
// both on disk; the next pass re-derives the same paths and finishes
// idempotently. No interruption can lose data.

import type {
  NoteConversionProgress,
  NoteEncStatus,
  StoredSnapshot,
} from "./adapter.ts";
import type { AttachmentStore } from "./attachment-store.ts";
import { attachmentPath } from "./attachment-reconcile.ts";
import {
  openBytes,
  openString,
  sealBytes,
  sealString,
} from "./crypto-binary.ts";
import {
  type SessionKeys,
  decryptEnvelope,
  isEncryptedEnvelope,
} from "./crypto.ts";
import type { EncNoteCacheEntry } from "./crypto-session.ts";
import { encJsonToNote, noteToEncJson } from "./enc-note-codec.ts";
import type { FileStore } from "./file-store.ts";
import { noteFileStem, noteToMarkdown } from "./markdown/codec.ts";
import { parse } from "./serialize.ts";
import type { Note } from "../domain/note.ts";
import { createLogger } from "../dev/logger.ts";

const log = createLogger("sync");

// Everything the converters need from the adapter closure. Module-level pure
// helpers (the codecs, the seal/open primitives, path joins) are imported
// directly above; only state and adapter-owned helpers are threaded here.
export type MigrationConverterDeps = {
  id: string;
  store: FileStore;
  attachments?: AttachmentStore;
  // The session passphrase, by reference — only the legacy split reads it (to
  // decrypt the old whole-document envelope before re-saving per-file).
  passwordRef?: { readonly current: string | null };
  // The crypto session: keys are derived once per passphrase and the ref
  // derivers + note cache are kept coherent with `save` by sharing this session.
  ensureKeys: () => Promise<SessionKeys | null>;
  encNotePath: (keys: SessionKeys, noteId: string) => Promise<string>;
  attBlobPath: (
    keys: SessionKeys,
    noteId: string,
    filename: string,
  ) => Promise<string>;
  encNoteCache: Map<string, EncNoteCacheEntry>;
  // Resolve a note's folder-aware plaintext `.md` path, the same way `save` does.
  plaintextNotePath: (note: Note) => string;
  // Revision tracking, owned by the adapter (shared with plan/save/conflict).
  track: (path: string, source: string, rev: string | undefined) => void;
  untrack: (path: string) => void;
  // The adapter's per-note at-rest encryption status map. Passed as callbacks
  // (not the Map) because the load path reassigns its binding — a closure always
  // sees the current map, a captured reference would not.
  setEncStatus: (noteId: string, status: NoteEncStatus) => void;
  deleteEncStatus: (noteId: string) => void;
  // Path vocabulary, passed in to keep this module free of an import cycle with
  // the adapter that owns it.
  blobFileName: string;
  isEncNotePath: (path: string) => boolean;
  // The adapter's own `save`, reused by the legacy split's representation switch.
  save: (text: string) => Promise<StoredSnapshot>;
};

export type MigrationConverters = {
  migrateNote(note: Note, onStep?: NoteConversionProgress): Promise<boolean>;
  demigrateNote(note: Note, onStep?: NoteConversionProgress): Promise<boolean>;
  splitLegacyBlob(): Promise<boolean>;
};

export function createMigrationConverters(
  deps: MigrationConverterDeps,
): MigrationConverters {
  const {
    id,
    store,
    attachments,
    passwordRef,
    ensureKeys,
    encNotePath,
    attBlobPath,
    encNoteCache,
    plaintextNotePath,
    track,
    untrack,
    setEncStatus,
    deleteEncStatus,
    blobFileName,
    isEncNotePath,
    save,
  } = deps;

  // Convert ONE note from plaintext to its encrypted per-file form, atomically:
  // seal each attachment's bytes into its opaque blob, write + verify the
  // encrypted note file, then remove the superseded plaintext `.md` and
  // attachment files. Idempotent — a note already migrated is a no-op. `onStep`
  // fires before each attachment and before the note file so the UI can flash
  // what it's sealing. Returns true when this call did work.
  async function migrateNote(
    note: Note,
    onStep?: NoteConversionProgress,
  ): Promise<boolean> {
    const keys = await ensureKeys();
    if (!keys) return false;
    const stem = noteFileStem(note);
    // The plaintext note lives at its folder-aware path; tolerate a flat path
    // too (a document written before folders became physical, or one a
    // plaintext save hasn't re-placed yet) so enabling encryption never leaves
    // a plaintext copy stranded on disk.
    const folderPath = plaintextNotePath(note);
    const flatPath = `${stem}.md`;
    const mdPath =
      (await store.read(folderPath)) !== null
        ? folderPath
        : (await store.read(flatPath)) !== null
          ? flatPath
          : null;
    // Already migrated (no plaintext note file left)?
    if (mdPath === null) {
      setEncStatus(note.id, "encrypted");
      return false;
    }

    // 1. Seal each attachment's bytes from its plaintext file into a blob.
    if (attachments) {
      for (const a of note.attachments ?? []) {
        onStep?.({ phase: "attachment", filename: a.filename });
        const blobPath = await attBlobPath(keys, note.id, a.filename);
        if ((await attachments.read(blobPath)) !== null) continue;
        const bytes = await attachments.read(attachmentPath(stem, a.filename));
        if (!bytes) continue;
        const blob = await sealBytes(keys.contentKey, bytes, {
          mime: a.mime,
          filename: a.filename,
        });
        await attachments.write(blobPath, blob, "application/octet-stream");
      }
    }

    // 2. Write + verify the encrypted note file.
    onStep?.({ phase: "note" });
    const encPath = await encNotePath(keys, note.id);
    const source = noteToEncJson(note);
    const rev = await store.write(
      encPath,
      await sealString(keys.contentKey, source),
    );
    track(encPath, source, rev);
    if (rev !== undefined) encNoteCache.set(encPath, { rev, json: source });
    const readBack = await store.read(encPath);
    if (readBack === null) throw new Error("migrate: enc note missing");
    const opened = await openString(keys.contentKey, readBack);
    if (new TextDecoder().decode(opened.bytes) !== source) {
      throw new Error("migrate: verify mismatch");
    }

    // 3. Remove the superseded plaintext only after the ciphertext is proven.
    await store.remove(mdPath);
    untrack(mdPath);
    if (attachments) {
      for (const a of note.attachments ?? []) {
        await attachments
          .remove(attachmentPath(stem, a.filename))
          .catch(() => {});
      }
    }
    setEncStatus(note.id, "encrypted");
    return true;
  }

  // The exact reverse of `migrateNote`: convert ONE note from its encrypted
  // per-file form back to plaintext, atomically — decrypt each attachment blob
  // into its plaintext `<stem>/<filename>` file, write + verify the plaintext
  // `.md` note, then remove the superseded `.enc` note and opaque attachment
  // blobs. Same write-new → verify → delete-old ordering as the forward path, so
  // an interruption leaves both representations for an idempotent resume rather
  // than losing data. Idempotent — a note already plaintext is a no-op. Returns
  // true when it worked.
  async function demigrateNote(
    note: Note,
    onStep?: NoteConversionProgress,
  ): Promise<boolean> {
    const keys = await ensureKeys();
    if (!keys) return false;
    const encPath = await encNotePath(keys, note.id);
    // Already demigrated (no encrypted note file left)?
    const encText = await store.read(encPath);
    if (encText === null) {
      deleteEncStatus(note.id);
      return false;
    }
    // The `.enc` is authoritative for the body: the note handed in may be
    // deferred (index metadata only, no body), so decrypt the file and write
    // the plaintext from *that* — never from a possibly-empty in-memory body.
    let full = note;
    try {
      const opened = await openString(keys.contentKey, encText);
      const decoded = encJsonToNote(new TextDecoder().decode(opened.bytes));
      if (decoded) full = decoded;
    } catch (err) {
      log.warn(`${id} demigrate: decrypt failed, using in-memory`, err);
    }
    const stem = noteFileStem(full);

    // 1. Decrypt each attachment blob back into its plaintext file.
    if (attachments) {
      for (const a of full.attachments ?? []) {
        onStep?.({ phase: "attachment", filename: a.filename });
        const plainPath = attachmentPath(stem, a.filename);
        if ((await attachments.read(plainPath)) !== null) continue;
        const blob = await attachments.read(
          await attBlobPath(keys, full.id, a.filename),
        );
        if (!blob) continue;
        const opened = await openBytes(keys.contentKey, blob);
        const mime = (opened.header.mime as string) ?? a.mime;
        await attachments.write(plainPath, new Uint8Array(opened.bytes), mime);
      }
    }

    // 2. Write + verify the plaintext markdown note file at its folder-aware
    // path, so disabling encryption lands a grouped note back in its folder
    // directory rather than flat at the notes root.
    onStep?.({ phase: "note" });
    const mdPath = plaintextNotePath(full);
    const text = noteToMarkdown(full, mdPath.includes("/") ? 1 : 0);
    const rev = await store.write(mdPath, text);
    track(mdPath, text, rev);
    const readBack = await store.read(mdPath);
    if (readBack === null) throw new Error("demigrate: md note missing");
    if (readBack !== text) throw new Error("demigrate: verify mismatch");

    // 3. Remove the superseded ciphertext only after the plaintext is proven.
    await store.remove(encPath);
    untrack(encPath);
    encNoteCache.delete(encPath);
    if (attachments) {
      for (const a of full.attachments ?? []) {
        await attachments
          .remove(await attBlobPath(keys, full.id, a.filename))
          .catch(() => {});
      }
    }
    deleteEncStatus(full.id);
    return true;
  }

  // One-time upgrade for existing users: a legacy whole-document `notes.json`
  // envelope is decrypted and re-saved as the per-file form, then the blob is
  // removed (the save's representation-switch supersede handles that atomically:
  // the per-file notes + attachment blobs are written and verified before the
  // blob goes). The legacy blob folds attachment bytes inline, so the decrypted
  // snapshot carries them and they land in their own encrypted blobs. Idempotent
  // and a no-op once split. Returns true when it did the split.
  async function splitLegacyBlob(): Promise<boolean> {
    const keys = await ensureKeys();
    if (!keys) return false;
    const password = passwordRef?.current;
    if (!password) return false;
    const entries = await store.list();
    if (!entries.some((e) => e.path === blobFileName)) return false;
    // Already split (per-file notes exist) — nothing to do.
    if (entries.some((e) => isEncNotePath(e.path))) return false;
    const blob = await store.read(blobFileName);
    if (!blob || !isEncryptedEnvelope(blob)) return false;
    log.info(`${id}: splitting legacy notes.json into per-file form`);
    const plaintext = await decryptEnvelope(blob, password);
    // save() in encrypted mode writes per-file + reconciles attachment blobs
    // from the inline data + supersedes (removes) notes.json after verifying.
    await save(plaintext);
    for (const note of parse(plaintext).notes) {
      setEncStatus(note.id, "encrypted");
    }
    return true;
  }

  return { migrateNote, demigrateNote, splitLegacyBlob };
}
