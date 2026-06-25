// The attachment-externalisation concern, factored out of the directory
// adapter. Each file/cloud backend stores a note's pasted attachments
// (images and other files) as real files alongside the note, and this module
// owns reconciling that on-disk attachment tree against the in-memory document
// on every load and save, for both representations:
//
//   - **Plaintext**: one `<note-stem>/<filename>` file per attachment.
//   - **Encrypted**: one opaque sealed blob per attachment, named by a keyed
//     HMAC of `<noteId> <filename>` (derived by the adapter's `attBlobPath`,
//     passed in per call so this module never depends on the crypto session).
//
// It carries one piece of session state — `attachmentsTouched`, the "has this
// session ever seen any attachment activity?" flag that lets a vault with no
// attachments skip the extra `attachments.list()` round-trip on every save —
// so it is built as a factory the adapter constructs once and threads its
// load/save calls through. The flag is set by the load path (hydration, the
// encrypted metadata fill, and the adapter's encrypted-load fast path via
// `markTouched()`) and read by the two reconcile passes; keeping it in one
// place is the whole reason the load- and save-side attachment logic moved
// together rather than splitting across the adapter and this module.

import type { NoteEncStatus } from "./adapter.ts";
import { type AttachmentStore, dataUrlToBytes } from "./attachment-store.ts";
import type { SessionKeys } from "./crypto.ts";
import { sealBytes } from "./crypto-binary.ts";
import { noteFileStem } from "./markdown/codec.ts";
import { parse, serialize } from "./serialize.ts";
import {
  type Attachment,
  mimeForFilename,
  referencedAttachments,
} from "../domain/attachment.ts";
import type { Note, Snapshot } from "../domain/note.ts";
import { createLogger } from "../dev/logger.ts";

const log = createLogger("sync");

// -- on-disk attachment path helpers ---------------------------------------
//
// Shared with the adapter's fetch / migrate / demigrate paths and its
// representation-switch supersede, so they live here next to the reconcile
// logic that defines the layout and are imported back into the adapter.

// The on-disk path of a plaintext attachment file, relative to the attachment
// store root: `<note-stem>/<filename>`.
export function attachmentPath(stem: string, filename: string): string {
  return `${stem}/${filename}`;
}

export function stemOfAttachmentPath(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

// A plaintext attachment file is grouped under a note-stem folder (`<stem>/…`);
// an encrypted attachment blob is a flat opaque ref (no slash). Telling them
// apart lets a representation switch clear only the superseded kind.
export function isPlaintextAttachmentPath(path: string): boolean {
  return path.includes("/");
}

// The attachments a note keeps on disk. The body is the source of truth for
// which attachments are still referenced, so for a loaded note we intersect the
// declared attachments with those the body actually links — orphan pruning. A
// **deferred** note (body not loaded, lazy backend) was not edited this session,
// so its attachments can't have changed; we keep every declared one rather than
// re-deriving from a body we don't have — this is what stops a save triggered by
// editing one note from pruning an unopened note's attachment blobs.
export function keptAttachments(note: Note): readonly Attachment[] {
  if (note.body === undefined) return note.attachments ?? [];
  return referencedAttachments(note.body, note.attachments);
}

// The opaque ref deriver the adapter owns (a keyed HMAC over the crypto
// session): passed into the encrypted reconcile per call so this module stays
// independent of the crypto session.
type AttBlobPath = (
  keys: SessionKeys,
  noteId: string,
  filename: string,
) => Promise<string>;

export type AttachmentReconciler = {
  // Flag this session as having seen attachment activity, so the next save's
  // reconcile runs its listing even when the document currently declares none
  // (an attachment may need removing). Used by the adapter's encrypted-load
  // fast path, which spots attachment metadata without going through hydration.
  markTouched(): void;
  // Load: attach each plaintext note's attachment *metadata* (filename + mime)
  // from the file listing, returning the snapshot text with it folded in. No
  // bytes are read — those are fetched on demand when a note is opened.
  hydratePlaintext(text: string): Promise<string>;
  // Load (encrypted): fill in attachment metadata for the loaded notes and
  // downgrade any note still holding a plaintext attachment file to "pending".
  attachEncryptedMetadata(
    notes: Note[],
    status: Map<string, NoteEncStatus>,
  ): Promise<void>;
  // Save: write the new plaintext attachment files and remove the orphaned ones.
  reconcilePlaintext(snapshot: Snapshot): Promise<void>;
  // Save: write the new encrypted attachment blobs and remove the orphaned ones.
  reconcileEncrypted(
    keys: SessionKeys,
    snapshot: Snapshot,
    attBlobPath: AttBlobPath,
  ): Promise<void>;
  // Representation switch: remove the superseded attachment files whose path the
  // predicate rejects (so encrypted blobs and plaintext files don't wipe each
  // other out).
  clearWhere(keep: (path: string) => boolean): Promise<void>;
  // Legacy: clear every externalised attachment file (used when the document is
  // folded into the single-blob envelope).
  clearAll(): Promise<void>;
};

export function createAttachmentReconciler(opts: {
  attachments: AttachmentStore | undefined;
  id: string;
}): AttachmentReconciler {
  const { attachments, id } = opts;
  let attachmentsTouched = false;

  function markTouched(): void {
    attachmentsTouched = true;
  }

  // -- Plaintext load --------------------------------------------------------

  async function hydratePlaintext(text: string): Promise<string> {
    if (!attachments) return text;
    let entries: { path: string }[];
    try {
      entries = await attachments.list();
    } catch (err) {
      log.warn(`${id} load: listing attachments failed`, err);
      return text;
    }
    if (entries.length === 0) return text;
    attachmentsTouched = true;

    const snapshot = parse(text);
    const byStem = new Map<string, string[]>();
    for (const entry of entries) {
      const stem = stemOfAttachmentPath(entry.path);
      if (!stem) continue;
      const list = byStem.get(stem) ?? [];
      list.push(entry.path);
      byStem.set(stem, list);
    }

    for (const note of snapshot.notes) {
      const stem = noteFileStem(note);
      const paths = byStem.get(stem);
      if (!paths || paths.length === 0) continue;
      const out: Attachment[] = paths.map((path) => {
        const filename = path.slice(stem.length + 1);
        return { filename, mime: mimeForFilename(filename) };
      });
      if (out.length > 0) note.attachments = out;
    }
    return serialize(snapshot);
  }

  // -- Encrypted load --------------------------------------------------------

  // Encrypted notes already carry their attachment metadata (from the note
  // file); plaintext remnants get theirs from the attachment listing.
  async function attachEncryptedMetadata(
    notes: Note[],
    status: Map<string, NoteEncStatus>,
  ): Promise<void> {
    if (!attachments) return;
    let entries: { path: string }[];
    try {
      entries = await attachments.list();
    } catch (err) {
      log.warn(`${id} load: listing enc attachments failed`, err);
      return;
    }
    if (entries.length === 0) return;
    attachmentsTouched = true;
    // Plaintext attachment files still on disk, grouped by note stem.
    const plaintextByStem = new Map<string, string[]>();
    for (const entry of entries) {
      if (!isPlaintextAttachmentPath(entry.path)) continue;
      const stem = stemOfAttachmentPath(entry.path);
      const list = plaintextByStem.get(stem) ?? [];
      list.push(entry.path);
      plaintextByStem.set(stem, list);
    }
    for (const note of notes) {
      const stem = noteFileStem(note);
      const plaintext = plaintextByStem.get(stem);
      if (plaintext && plaintext.length > 0) {
        // A plaintext attachment file lingers → the note isn't fully encrypted.
        status.set(note.id, "pending");
        if (!note.attachments) {
          note.attachments = plaintext.map((p) => {
            const filename = p.slice(stem.length + 1);
            return { filename, mime: mimeForFilename(filename) };
          });
        }
      }
    }
  }

  // -- Plaintext save reconcile ----------------------------------------------

  function desiredAttachments(snapshot: Snapshot): Map<string, Attachment> {
    const desired = new Map<string, Attachment>();
    for (const note of snapshot.notes) {
      const stem = noteFileStem(note);
      for (const a of keptAttachments(note)) {
        desired.set(attachmentPath(stem, a.filename), a);
      }
    }
    return desired;
  }

  async function reconcilePlaintext(snapshot: Snapshot): Promise<void> {
    if (!attachments) return;
    const desired = desiredAttachments(snapshot);
    if (desired.size === 0 && !attachmentsTouched) return;
    if (desired.size > 0) attachmentsTouched = true;
    let current: { path: string }[];
    try {
      current = await attachments.list();
    } catch (err) {
      log.warn(`${id} save: listing attachments failed`, err);
      current = [];
    }
    // Only the plaintext attachment files are this path's concern; a flat
    // opaque blob belongs to the encrypted representation.
    const currentPaths = new Set(
      current.map((e) => e.path).filter(isPlaintextAttachmentPath),
    );
    if (currentPaths.size > 0) attachmentsTouched = true;

    const toWrite: [string, Attachment][] = [];
    for (const [path, attachment] of desired) {
      if (!currentPaths.has(path)) toWrite.push([path, attachment]);
    }
    const toRemove = [...currentPaths].filter((p) => !desired.has(p));
    if (toWrite.length === 0 && toRemove.length === 0) return;
    log.info(
      `${id} save: attachments write=${toWrite.length} remove=${toRemove.length}`,
    );

    await Promise.all(
      toWrite.map(async ([path, attachment]) => {
        const decoded = dataUrlToBytes(attachment.data);
        if (!decoded) return;
        await attachments.write(path, decoded.bytes, decoded.mime);
      }),
    );
    await Promise.all(toRemove.map((path) => attachments.remove(path)));
  }

  // -- Encrypted save reconcile ----------------------------------------------

  // The encrypted attachment blobs a snapshot wants on disk, keyed by opaque
  // ref. Every referenced attachment is desired (so an existing one isn't
  // removed even when its bytes aren't in memory); only those that still carry
  // bytes are (re)written.
  async function encDesiredAttachments(
    keys: SessionKeys,
    snapshot: Snapshot,
    attBlobPath: AttBlobPath,
  ): Promise<Map<string, Attachment>> {
    const desired = new Map<string, Attachment>();
    for (const note of snapshot.notes) {
      for (const a of keptAttachments(note)) {
        desired.set(await attBlobPath(keys, note.id, a.filename), a);
      }
    }
    return desired;
  }

  async function reconcileEncrypted(
    keys: SessionKeys,
    snapshot: Snapshot,
    attBlobPath: AttBlobPath,
  ): Promise<void> {
    if (!attachments) return;
    const desired = await encDesiredAttachments(keys, snapshot, attBlobPath);
    if (desired.size === 0 && !attachmentsTouched) return;
    if (desired.size > 0) attachmentsTouched = true;
    let current: { path: string }[];
    try {
      current = await attachments.list();
    } catch (err) {
      log.warn(`${id} save: listing enc attachments failed`, err);
      current = [];
    }
    const currentBlobs = new Set(
      current.map((e) => e.path).filter((p) => !isPlaintextAttachmentPath(p)),
    );
    if (currentBlobs.size > 0) attachmentsTouched = true;

    const toWrite: [string, Attachment][] = [];
    for (const [path, attachment] of desired) {
      // Already on disk (content-addressed by ref → bytes never change) → skip;
      // or no bytes in memory to write → skip (it must already exist).
      if (currentBlobs.has(path) || !attachment.data) continue;
      toWrite.push([path, attachment]);
    }
    const toRemove = [...currentBlobs].filter((p) => !desired.has(p));
    if (toWrite.length === 0 && toRemove.length === 0) return;
    log.info(
      `${id} save: enc attachments write=${toWrite.length} remove=${toRemove.length}`,
    );

    await Promise.all(
      toWrite.map(async ([path, attachment]) => {
        const decoded = dataUrlToBytes(attachment.data);
        if (!decoded) return;
        const blob = await sealBytes(keys.contentKey, decoded.bytes, {
          mime: decoded.mime,
          filename: attachment.filename,
        });
        await attachments.write(path, blob, "application/octet-stream");
      }),
    );
    await Promise.all(toRemove.map((path) => attachments.remove(path)));
  }

  // -- Representation-switch supersede ---------------------------------------

  async function clearWhere(keep: (path: string) => boolean): Promise<void> {
    if (!attachments) return;
    let current: { path: string }[];
    try {
      current = await attachments.list();
    } catch (err) {
      log.warn(`${id} save: listing attachments to clear failed`, err);
      return;
    }
    const drop = current.map((e) => e.path).filter((p) => !keep(p));
    if (drop.length === 0) return;
    log.info(`${id} save: clearing ${drop.length} attachment file(s)`);
    await Promise.all(drop.map((path) => attachments.remove(path)));
  }

  async function clearAll(): Promise<void> {
    await clearWhere(() => false);
  }

  return {
    markTouched,
    hydratePlaintext,
    attachEncryptedMetadata,
    reconcilePlaintext,
    reconcileEncrypted,
    clearWhere,
    clearAll,
  };
}
