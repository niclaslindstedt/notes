import { describe, expect, it } from "vitest";

import {
  attachmentMarkdown,
  type Attachment,
} from "../../src/domain/attachment.ts";
import { createNote, type Note } from "../../src/domain/note.ts";
import type { NoteEncStatus } from "../../src/storage/adapter.ts";
import {
  attachmentPath,
  createAttachmentReconciler,
  isPlaintextAttachmentPath,
  keptAttachments,
  stemOfAttachmentPath,
} from "../../src/storage/attachment-reconcile.ts";
import type {
  AttachmentEntry,
  AttachmentStore,
} from "../../src/storage/attachment-store.ts";
import { deriveSessionKeys, newKeyParams } from "../../src/storage/crypto.ts";
import { openBytes } from "../../src/storage/crypto-binary.ts";
import { noteFileStem } from "../../src/storage/markdown/codec.ts";
import { parse, serialize } from "../../src/storage/serialize.ts";

// In-memory AttachmentStore that counts its `list` calls, so the
// short-circuit (skip the listing when nothing has touched attachments) can be
// asserted directly.
type MemoryAttachments = AttachmentStore & {
  files: Map<string, { bytes: Uint8Array; mime: string }>;
  listCalls: number;
};

function memoryAttachments(
  seed: Record<string, { bytes: Uint8Array; mime: string }> = {},
): MemoryAttachments {
  const files = new Map(Object.entries(seed));
  const store: MemoryAttachments = {
    files,
    listCalls: 0,
    async list(): Promise<AttachmentEntry[]> {
      store.listCalls += 1;
      return [...files.keys()].map((path) => ({ path }));
    },
    async read(path) {
      return files.get(path)?.bytes ?? null;
    },
    async write(path, bytes, mime) {
      files.set(path, { bytes: new Uint8Array(bytes), mime });
    },
    async remove(path) {
      files.delete(path);
    },
  };
  return store;
}

// "Hello" as a base64 PNG data URL — the codec only decodes the base64, so the
// payload needn't be a real image for the round-trip assertions.
const DATA_URL = "data:image/png;base64,SGVsbG8=";
const HELLO = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"

function noteWithImage(seq = 1): { note: Note; attachment: Attachment } {
  const attachment: Attachment = {
    filename: "abcd1234-pic.png",
    mime: "image/png",
    data: DATA_URL,
  };
  const note: Note = {
    ...createNote(seq),
    title: "Trip",
    body: `intro\n${attachmentMarkdown(attachment)}`,
    attachments: [attachment],
  };
  return { note, attachment };
}

describe("attachment path helpers", () => {
  it("builds and splits a plaintext attachment path", () => {
    expect(attachmentPath("trip-note", "pic.png")).toBe("trip-note/pic.png");
    expect(stemOfAttachmentPath("trip-note/pic.png")).toBe("trip-note");
    expect(stemOfAttachmentPath("flat-blob-ref")).toBe("");
  });

  it("tells a grouped plaintext file from a flat opaque blob", () => {
    expect(isPlaintextAttachmentPath("stem/pic.png")).toBe(true);
    expect(isPlaintextAttachmentPath("a1b2c3opaqueref")).toBe(false);
  });

  it("prunes a loaded note's unreferenced attachments but keeps a deferred note's", () => {
    const { note, attachment } = noteWithImage();
    // Loaded note: body references the attachment → kept.
    expect(keptAttachments(note)).toEqual([attachment]);
    // Loaded note whose body dropped the reference → pruned as an orphan.
    expect(keptAttachments({ ...note, body: "intro only" })).toEqual([]);
    // Deferred note (no body): every declared attachment kept, un-pruned.
    expect(keptAttachments({ ...note, body: undefined })).toEqual([attachment]);
  });
});

describe("attachment reconciler — plaintext save", () => {
  it("writes a new plaintext attachment file for a referenced attachment", async () => {
    const attachments = memoryAttachments();
    const r = createAttachmentReconciler({ attachments, id: "folder" });
    const { note } = noteWithImage();
    await r.reconcilePlaintext({ notes: [note] });

    const path = attachmentPath(noteFileStem(note), "abcd1234-pic.png");
    expect([...attachments.files.keys()]).toEqual([path]);
    expect(attachments.files.get(path)?.bytes).toEqual(HELLO);
  });

  it("removes an orphaned plaintext file no note references any more", async () => {
    const { note } = noteWithImage();
    const stem = noteFileStem(note);
    const attachments = memoryAttachments({
      [attachmentPath(stem, "abcd1234-pic.png")]: {
        bytes: HELLO,
        mime: "image/png",
      },
      [attachmentPath(stem, "gone.png")]: { bytes: HELLO, mime: "image/png" },
    });
    const r = createAttachmentReconciler({ attachments, id: "folder" });
    await r.reconcilePlaintext({ notes: [note] });

    expect([...attachments.files.keys()]).toEqual([
      attachmentPath(stem, "abcd1234-pic.png"),
    ]);
  });

  it("short-circuits the listing when nothing has ever touched attachments", async () => {
    const attachments = memoryAttachments();
    const r = createAttachmentReconciler({ attachments, id: "folder" });
    // A note with no attachments → empty desired, never touched → no list call.
    await r.reconcilePlaintext({ notes: [createNote(1)] });
    expect(attachments.listCalls).toBe(0);
  });

  it("still reconciles after markTouched even when the document declares none", async () => {
    const { note } = noteWithImage();
    const stem = noteFileStem(note);
    const attachments = memoryAttachments({
      [attachmentPath(stem, "abcd1234-pic.png")]: {
        bytes: HELLO,
        mime: "image/png",
      },
    });
    const r = createAttachmentReconciler({ attachments, id: "folder" });
    r.markTouched();
    // Document now has a note with no attachments → the stale file is pruned.
    await r.reconcilePlaintext({
      notes: [{ ...note, attachments: undefined, body: "no image" }],
    });
    expect(attachments.listCalls).toBe(1);
    expect(attachments.files.size).toBe(0);
  });
});

describe("attachment reconciler — plaintext load hydration", () => {
  it("folds attachment metadata into the snapshot from the file listing", async () => {
    const { note } = noteWithImage();
    const stem = noteFileStem(note);
    const attachments = memoryAttachments({
      [attachmentPath(stem, "abcd1234-pic.png")]: {
        bytes: HELLO,
        mime: "image/png",
      },
    });
    const r = createAttachmentReconciler({ attachments, id: "folder" });
    // The on-disk snapshot text carries the note but no attachment metadata.
    const bare = serialize({ notes: [{ ...note, attachments: undefined }] });
    const hydrated = await r.hydratePlaintext(bare);
    const out = parse(hydrated).notes[0]!;
    expect(out.attachments).toEqual([
      { filename: "abcd1234-pic.png", mime: "image/png" },
    ]);
  });

  it("returns the text untouched when there are no attachment files", async () => {
    const attachments = memoryAttachments();
    const r = createAttachmentReconciler({ attachments, id: "folder" });
    const text = serialize({ notes: [createNote(1)] });
    expect(await r.hydratePlaintext(text)).toBe(text);
  });
});

describe("attachment reconciler — encrypted load metadata", () => {
  it("downgrades a note with a lingering plaintext attachment file to pending", async () => {
    const { note } = noteWithImage();
    const stem = noteFileStem(note);
    const attachments = memoryAttachments({
      [attachmentPath(stem, "abcd1234-pic.png")]: {
        bytes: HELLO,
        mime: "image/png",
      },
    });
    const r = createAttachmentReconciler({ attachments, id: "folder" });
    const status = new Map<string, NoteEncStatus>([[note.id, "encrypted"]]);
    // Pass the note without metadata so the listing fills it in.
    const loaded: Note = { ...note, attachments: undefined };
    await r.attachEncryptedMetadata([loaded], status);
    expect(status.get(note.id)).toBe("pending");
    expect(loaded.attachments).toEqual([
      { filename: "abcd1234-pic.png", mime: "image/png" },
    ]);
  });
});

describe("attachment reconciler — encrypted save", () => {
  // A deterministic ref deriver standing in for the adapter's keyed-HMAC
  // `attBlobPath`; the reconcile logic only needs it to be stable per (id,
  // filename), and the seal uses the real session content key.
  const attBlobPath = async (
    _keys: unknown,
    noteId: string,
    filename: string,
  ): Promise<string> => `blob-${noteId}-${filename}`;

  it("seals and writes a blob for a referenced attachment, round-tripping", async () => {
    const keys = await deriveSessionKeys("pw", newKeyParams());
    const attachments = memoryAttachments();
    const r = createAttachmentReconciler({ attachments, id: "folder" });
    const { note } = noteWithImage();
    await r.reconcileEncrypted(keys, { notes: [note] }, attBlobPath);

    const ref = `blob-${note.id}-abcd1234-pic.png`;
    const blob = attachments.files.get(ref);
    expect(blob?.mime).toBe("application/octet-stream");
    const opened = await openBytes(keys.contentKey, blob!.bytes);
    expect(new Uint8Array(opened.bytes)).toEqual(HELLO);
  });

  it("skips a blob already on disk (content-addressed) and removes orphans", async () => {
    const keys = await deriveSessionKeys("pw", newKeyParams());
    const { note } = noteWithImage();
    const ref = `blob-${note.id}-abcd1234-pic.png`;
    const sentinel = new Uint8Array([1, 2, 3]);
    const attachments = memoryAttachments({
      [ref]: { bytes: sentinel, mime: "application/octet-stream" },
      "orphan-ref": { bytes: HELLO, mime: "application/octet-stream" },
    });
    const r = createAttachmentReconciler({ attachments, id: "folder" });
    await r.reconcileEncrypted(keys, { notes: [note] }, attBlobPath);

    // Existing blob untouched (not resealed); the orphan removed.
    expect(attachments.files.get(ref)?.bytes).toEqual(sentinel);
    expect(attachments.files.has("orphan-ref")).toBe(false);
  });

  it("keeps a referenced attachment with no in-memory bytes (must already exist)", async () => {
    const keys = await deriveSessionKeys("pw", newKeyParams());
    const { note } = noteWithImage();
    const ref = `blob-${note.id}-abcd1234-pic.png`;
    const attachments = memoryAttachments({
      [ref]: { bytes: HELLO, mime: "application/octet-stream" },
    });
    const r = createAttachmentReconciler({ attachments, id: "folder" });
    // Deferred-style note: metadata only, no bytes — must not be removed.
    const metaOnly: Note = {
      ...note,
      attachments: [{ filename: "abcd1234-pic.png", mime: "image/png" }],
    };
    await r.reconcileEncrypted(keys, { notes: [metaOnly] }, attBlobPath);
    expect(attachments.files.has(ref)).toBe(true);
  });
});

describe("attachment reconciler — representation-switch clears", () => {
  it("clearWhere removes only the files the predicate rejects", async () => {
    const attachments = memoryAttachments({
      "stem/pic.png": { bytes: HELLO, mime: "image/png" },
      opaqueblobref: { bytes: HELLO, mime: "application/octet-stream" },
    });
    const r = createAttachmentReconciler({ attachments, id: "folder" });
    // Keep the encrypted blobs, drop the plaintext grouped files.
    await r.clearWhere((p) => !isPlaintextAttachmentPath(p));
    expect([...attachments.files.keys()]).toEqual(["opaqueblobref"]);
  });

  it("clearAll removes every externalised file", async () => {
    const attachments = memoryAttachments({
      "stem/pic.png": { bytes: HELLO, mime: "image/png" },
      opaqueblobref: { bytes: HELLO, mime: "application/octet-stream" },
    });
    const r = createAttachmentReconciler({ attachments, id: "folder" });
    await r.clearAll();
    expect(attachments.files.size).toBe(0);
  });
});

describe("attachment reconciler — no store", () => {
  it("no-ops every method when there is no attachment store", async () => {
    const r = createAttachmentReconciler({
      attachments: undefined,
      id: "browser",
    });
    const text = serialize({ notes: [createNote(1)] });
    expect(await r.hydratePlaintext(text)).toBe(text);
    // None of these throw despite the absent store.
    await r.reconcilePlaintext({ notes: [noteWithImage().note] });
    await r.attachEncryptedMetadata([noteWithImage().note], new Map());
    await r.clearAll();
  });
});
