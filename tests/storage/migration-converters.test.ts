import { describe, expect, it } from "vitest";

import { createNote, type Note } from "../../src/domain/note.ts";
import type { StoredSnapshot } from "../../src/storage/adapter.ts";
import {
  type AttachmentEntry,
  type AttachmentStore,
} from "../../src/storage/attachment-store.ts";
import { createCryptoSession } from "../../src/storage/crypto-session.ts";
import type { SessionKeys } from "../../src/storage/crypto.ts";
import type { FileEntry, FileStore } from "../../src/storage/file-store.ts";
import { noteFileStem } from "../../src/storage/markdown/codec.ts";
import { createMigrationConverters } from "../../src/storage/migration-converters.ts";

type MemFile = { text: string; rev: number };

function memoryStore() {
  let counter = 0;
  const files = new Map<string, MemFile>();
  const store: FileStore & { files: Map<string, MemFile> } = {
    files,
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
  return store;
}

function memoryAttachments(): AttachmentStore & {
  files: Map<string, { bytes: Uint8Array; mime: string }>;
} {
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

// Build the converter under test wired to a real crypto session + in-memory
// stores, exposing the adapter-owned state (tracked / encStatus) as plain maps
// so the deps-wiring contract introduced by the extraction can be asserted
// directly. `plaintextNotePath` mirrors the flat `<stem>.md` the adapter uses
// when a note has no folder.
function harness(password: string | null = "hunter2") {
  const store = memoryStore();
  const attachments = memoryAttachments();
  const passwordRef = { current: password };
  const session = createCryptoSession({ store, passwordRef });
  const tracked = new Map<
    string,
    { source: string; rev: string | undefined }
  >();
  const encStatus = new Map<string, string>();

  const encNotePath = async (keys: SessionKeys, noteId: string) =>
    `${await session.cachedRef(keys, "note", noteId)}.enc`;
  const attBlobPath = (keys: SessionKeys, noteId: string, filename: string) =>
    session.cachedRef(keys, "att", `${noteId} ${filename}`);

  const savedTexts: string[] = [];
  const converters = createMigrationConverters({
    id: "test",
    store,
    attachments,
    passwordRef,
    ensureKeys: session.ensureKeys,
    encNotePath,
    attBlobPath,
    encNoteCache: session.encNoteCache,
    plaintextNotePath: (note) => `${noteFileStem(note)}.md`,
    track: (path, source, rev) => tracked.set(path, { source, rev }),
    untrack: (path) => tracked.delete(path),
    setEncStatus: (id, status) => encStatus.set(id, status),
    deleteEncStatus: (id) => encStatus.delete(id),
    blobFileName: "notes.json",
    isEncNotePath: (path) => path.endsWith(".enc"),
    save: async (text) => {
      savedTexts.push(text);
      return { text, revision: "" } satisfies StoredSnapshot;
    },
  });

  return {
    store,
    attachments,
    session,
    tracked,
    encStatus,
    encNotePath,
    savedTexts,
    converters,
  };
}

function plaintextNote(seed = 1): Note {
  return {
    ...createNote(seed),
    title: "My Note",
    body: "secret body",
  };
}

describe("createMigrationConverters — migrateNote", () => {
  it("seals the note, removes the plaintext, and marks it encrypted", async () => {
    const h = harness();
    const note = plaintextNote();
    const mdPath = `${noteFileStem(note)}.md`;
    await h.store.write(mdPath, "secret body");

    expect(await h.converters.migrateNote(note)).toBe(true);

    // Plaintext gone, an `.enc` written, status flipped via the callback.
    expect(h.store.files.has(mdPath)).toBe(false);
    const encPaths = [...h.store.files.keys()].filter((p) =>
      p.endsWith(".enc"),
    );
    expect(encPaths).toHaveLength(1);
    expect(h.encStatus.get(note.id)).toBe("encrypted");
    // The new path is tracked and cached; the old one untracked.
    expect(h.tracked.has(encPaths[0]!)).toBe(true);
    expect(h.tracked.has(mdPath)).toBe(false);
    expect(h.session.encNoteCache.has(encPaths[0]!)).toBe(true);
  });

  it("is a no-op (still marks encrypted) when no plaintext file remains", async () => {
    const h = harness();
    const note = plaintextNote();
    // No `<stem>.md` on disk → already migrated.
    expect(await h.converters.migrateNote(note)).toBe(false);
    expect(h.encStatus.get(note.id)).toBe("encrypted");
  });

  it("returns false when no passphrase is held", async () => {
    const h = harness(null);
    const note = plaintextNote();
    await h.store.write(`${noteFileStem(note)}.md`, "secret body");
    expect(await h.converters.migrateNote(note)).toBe(false);
    expect(h.encStatus.has(note.id)).toBe(false);
  });
});

describe("createMigrationConverters — demigrateNote", () => {
  it("reverses a migrate: restores plaintext from the ciphertext body", async () => {
    const h = harness();
    const note = plaintextNote();
    const mdPath = `${noteFileStem(note)}.md`;
    await h.store.write(mdPath, "secret body");
    await h.converters.migrateNote(note);

    // Hand demigrate a deferred note (body undefined) to prove it decrypts the
    // authoritative `.enc` rather than trusting the in-memory body.
    const deferred: Note = { ...note, body: undefined as unknown as string };
    expect(await h.converters.demigrateNote(deferred)).toBe(true);

    expect(h.store.files.get(mdPath)?.text).toContain("secret body");
    expect([...h.store.files.keys()].some((p) => p.endsWith(".enc"))).toBe(
      false,
    );
    expect(h.encStatus.has(note.id)).toBe(false);
  });

  it("is a no-op (clears status) when no ciphertext remains", async () => {
    const h = harness();
    const note = plaintextNote();
    h.encStatus.set(note.id, "encrypted");
    expect(await h.converters.demigrateNote(note)).toBe(false);
    expect(h.encStatus.has(note.id)).toBe(false);
  });
});

describe("createMigrationConverters — splitLegacyBlob", () => {
  it("returns false when there is no legacy blob to split", async () => {
    const h = harness();
    expect(await h.converters.splitLegacyBlob()).toBe(false);
    expect(h.savedTexts).toHaveLength(0);
  });

  it("returns false when no passphrase is held", async () => {
    const h = harness(null);
    await h.store.write("notes.json", "anything");
    expect(await h.converters.splitLegacyBlob()).toBe(false);
    expect(h.savedTexts).toHaveLength(0);
  });
});
