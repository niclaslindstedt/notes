import { describe, expect, it } from "vitest";

import {
  attachmentMarkdown,
  type Attachment,
} from "../../src/domain/attachment.ts";
import { createNote, type Note } from "../../src/domain/note.ts";
import {
  bytesToDataUrl,
  dataUrlToBytes,
  type AttachmentEntry,
  type AttachmentStore,
} from "../../src/storage/attachment-store.ts";
import { createDirectoryAdapter } from "../../src/storage/directory-adapter.ts";
import type { FileEntry, FileStore } from "../../src/storage/file-store.ts";
import { noteFileStem } from "../../src/storage/markdown/codec.ts";
import { parse, serialize } from "../../src/storage/serialize.ts";

function memoryStore(): FileStore {
  const files = new Map<string, { text: string; rev: number }>();
  let counter = 0;
  return {
    async list(): Promise<FileEntry[]> {
      return [...files.entries()].map(([path, { rev }]) => ({
        path,
        rev: String(rev),
      }));
    },
    async read(path) {
      return files.get(path)?.text ?? null;
    },
    async write(path, text) {
      const rev = ++counter;
      files.set(path, { text, rev });
      return String(rev);
    },
    async remove(path) {
      files.delete(path);
    },
  };
}

type MemoryAttachmentStore = AttachmentStore & {
  files: Map<string, { bytes: Uint8Array; mime: string }>;
};

function memoryAttachments(): MemoryAttachmentStore {
  const files = new Map<string, { bytes: Uint8Array; mime: string }>();
  return {
    files,
    async list(): Promise<AttachmentEntry[]> {
      return [...files.keys()].map((path) => ({ path }));
    },
    async read(path) {
      return files.get(path)?.bytes ?? null;
    },
    async write(path, bytes, mime) {
      files.set(path, { bytes, mime });
    },
    async remove(path) {
      files.delete(path);
    },
  };
}

// "Hello" as a base64 PNG data URL — the codec only decodes the base64, so the
// payload needn't be a real image for the round-trip assertions.
const DATA_URL = "data:image/png;base64,SGVsbG8=";

function noteWithImage(): { note: Note; attachment: Attachment } {
  const attachment: Attachment = {
    filename: "abcd1234-pic.png",
    mime: "image/png",
    data: DATA_URL,
  };
  const note: Note = {
    ...createNote(100),
    title: "Trip",
    body: `intro\n${attachmentMarkdown(attachment)}`,
    attachments: [attachment],
  };
  return { note, attachment };
}

// A non-image file attachment, referenced in the body as a plain link.
const PDF_DATA_URL = "data:application/pdf;base64,SGVsbG8=";

function noteWithFile(): { note: Note; attachment: Attachment } {
  const attachment: Attachment = {
    filename: "abcd1234-report.pdf",
    mime: "application/pdf",
    data: PDF_DATA_URL,
  };
  const note: Note = {
    ...createNote(200),
    title: "Filed",
    body: `intro\n${attachmentMarkdown(attachment)}`,
    attachments: [attachment],
  };
  return { note, attachment };
}

describe("data: URL <-> bytes", () => {
  it("round-trips a base64 data URL", () => {
    const decoded = dataUrlToBytes(DATA_URL);
    expect(decoded).not.toBeNull();
    expect(decoded!.mime).toBe("image/png");
    expect(bytesToDataUrl(decoded!.mime, decoded!.bytes)).toBe(DATA_URL);
  });

  it("returns null for a non-data href", () => {
    expect(dataUrlToBytes("https://example.com/a.png")).toBeNull();
  });
});

describe("directory adapter attachments", () => {
  it("externalises a note's image to a file under its note-name folder", async () => {
    const store = memoryStore();
    const attachments = memoryAttachments();
    const a = createDirectoryAdapter(
      store,
      { id: "folder", label: "T" },
      attachments,
    );
    const { note } = noteWithImage();

    await a.save(serialize({ notes: [note] }));

    const stem = noteFileStem(note);
    const path = `${stem}/abcd1234-pic.png`;
    expect(attachments.files.has(path)).toBe(true);
    // The bytes on disk are the decoded image, not base64 text.
    expect([...attachments.files.get(path)!.bytes]).toEqual([
      ...dataUrlToBytes(DATA_URL)!.bytes,
    ]);
    // The markdown note carries only the reference, never the base64 payload.
    const md = await store.read(`${stem}.md`);
    expect(md).not.toContain("base64");
    expect(md).toContain(`../attachments/${stem}/abcd1234-pic.png`);
  });

  it("loads image metadata only, then fetches the bytes on demand", async () => {
    const store = memoryStore();
    const attachments = memoryAttachments();
    const a = createDirectoryAdapter(
      store,
      { id: "folder", label: "T" },
      attachments,
    );
    const { note } = noteWithImage();
    await a.save(serialize({ notes: [note] }));

    // A fresh adapter (cold) loads the attachment's metadata but not its bytes.
    const b = createDirectoryAdapter(
      store,
      { id: "folder", label: "T" },
      attachments,
    );
    const loaded = await b.load();
    const restored = parse(loaded?.text).notes[0]!;
    expect(restored.attachments).toEqual([
      { filename: "abcd1234-pic.png", mime: "image/png" },
    ]);

    // Opening the note fetches the bytes on demand.
    const got = await b.fetchAttachment!(restored, "abcd1234-pic.png");
    expect(got).not.toBeNull();
    expect(bytesToDataUrl(got!.mime, got!.bytes)).toBe(DATA_URL);
  });

  it("removes the image file when its reference is deleted from the body", async () => {
    const store = memoryStore();
    const attachments = memoryAttachments();
    const a = createDirectoryAdapter(
      store,
      { id: "folder", label: "T" },
      attachments,
    );
    const { note } = noteWithImage();
    await a.save(serialize({ notes: [note] }));
    expect(attachments.files.size).toBe(1);

    // The user deletes the image line; the attachment record may linger but the
    // file is reconciled away because the body no longer references it.
    const edited: Note = { ...note, body: "intro" };
    await a.save(serialize({ notes: [edited] }));
    expect(attachments.files.size).toBe(0);
  });

  it("clears externalised image files when the document is encrypted", async () => {
    const store = memoryStore();
    const attachments = memoryAttachments();
    const a = createDirectoryAdapter(
      store,
      { id: "folder", label: "T" },
      attachments,
    );
    const { note } = noteWithImage();
    await a.save(serialize({ notes: [note] }));
    expect(attachments.files.size).toBe(1);

    // Enabling encryption folds the image into the envelope, so the plaintext
    // copy on disk must be removed — leaving it would be a plaintext leak.
    const envelope = JSON.stringify({ encrypted: "notes.encrypted.v1" });
    await a.save(envelope);
    expect(attachments.files.size).toBe(0);
  });

  it("externalises and re-hydrates a non-image file attachment", async () => {
    const store = memoryStore();
    const attachments = memoryAttachments();
    const a = createDirectoryAdapter(
      store,
      { id: "folder", label: "T" },
      attachments,
    );
    const { note } = noteWithFile();
    await a.save(serialize({ notes: [note] }));

    const stem = noteFileStem(note);
    const path = `${stem}/abcd1234-report.pdf`;
    expect(attachments.files.has(path)).toBe(true);
    // The body keeps a plain link (not an image reference) to the file.
    const md = await store.read(`${stem}.md`);
    expect(md).toContain(`[abcd1234-report.pdf](../attachments/${stem}/`);
    expect(md).not.toContain("![abcd1234-report.pdf]");

    // A cold adapter loads the file attachment's metadata (recovered mime), and
    // fetches the bytes on demand.
    const b = createDirectoryAdapter(
      store,
      { id: "folder", label: "T" },
      attachments,
    );
    const loaded = await b.load();
    const restored = parse(loaded?.text).notes[0]!;
    expect(restored.attachments).toEqual([
      { filename: "abcd1234-report.pdf", mime: "application/pdf" },
    ]);
    const got = await b.fetchAttachment!(restored, "abcd1234-report.pdf");
    expect(bytesToDataUrl(got!.mime, got!.bytes)).toBe(PDF_DATA_URL);
  });

  it("advertises the attachments capability only when a store is wired", () => {
    const withStore = createDirectoryAdapter(
      memoryStore(),
      { id: "folder", label: "T" },
      memoryAttachments(),
    );
    const without = createDirectoryAdapter(memoryStore(), {
      id: "folder",
      label: "T",
    });
    expect(withStore.capabilities.has("attachments")).toBe(true);
    expect(without.capabilities.has("attachments")).toBe(false);
  });
});
