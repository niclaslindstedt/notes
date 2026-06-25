import { describe, expect, it } from "vitest";

import {
  FOLDERS_FILE_NAME,
  createFolderRegistry,
  injectFolders,
} from "../../src/storage/folder-registry.ts";
import type { FileEntry, FileStore } from "../../src/storage/file-store.ts";
import { noteFilePath } from "../../src/storage/markdown/codec.ts";
import { serialize, serializeFolders } from "../../src/storage/serialize.ts";
import {
  createFolder,
  createNote,
  type Folder,
} from "../../src/domain/note.ts";

type MemFile = { text: string; rev: number };

// A minimal in-memory FileStore that records reads/writes and can be told to
// throw on the next N reads of a path (to exercise the sidecar read retry).
function memoryStore(files = new Map<string, MemFile>()) {
  let counter = 0;
  const reads: string[] = [];
  const writes: string[] = [];
  // path → how many of the upcoming reads of it should throw before succeeding.
  const failReads = new Map<string, number>();
  const store: FileStore & {
    files: Map<string, MemFile>;
    reads: string[];
    writes: string[];
    failReads: Map<string, number>;
  } = {
    files,
    reads,
    writes,
    failReads,
    async list(): Promise<FileEntry[]> {
      return [...files.entries()].map(([path, { rev }]) => ({
        path,
        rev: String(rev),
      }));
    },
    async read(path) {
      const left = failReads.get(path) ?? 0;
      if (left > 0) {
        failReads.set(path, left - 1);
        throw new Error("transient read failure");
      }
      reads.push(path);
      return files.get(path)?.text ?? null;
    },
    async write(path, text) {
      writes.push(path);
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

const FOLDER_A: Folder = { id: "f-a", name: "Work", createdAt: 1000 };
const FOLDER_B: Folder = { id: "f-b", name: "Travel", createdAt: 2000 };

function withFolders(store: ReturnType<typeof memoryStore>, folders: Folder[]) {
  store.files.set(FOLDERS_FILE_NAME, {
    text: serializeFolders(folders),
    rev: 1,
  });
}

describe("createFolderRegistry", () => {
  it("yields no folders and readOk when the sidecar is missing", async () => {
    const store = memoryStore();
    const registry = createFolderRegistry({ store, id: "test" });

    expect(await registry.readFolders()).toEqual([]);
    expect(registry.readOk()).toBe(true);
  });

  it("reads and parses the folder sidecar", async () => {
    const store = memoryStore();
    withFolders(store, [FOLDER_A, FOLDER_B]);
    const registry = createFolderRegistry({ store, id: "test" });

    expect(await registry.readFolders()).toEqual([FOLDER_A, FOLDER_B]);
    expect(registry.readOk()).toBe(true);
  });

  it("retries a transiently-failing read instead of dropping the registry", async () => {
    const store = memoryStore();
    withFolders(store, [FOLDER_A]);
    // First read of the sidecar throws; the retry succeeds.
    store.failReads.set(FOLDERS_FILE_NAME, 1);
    const registry = createFolderRegistry({ store, id: "test" });

    expect(await registry.readFolders()).toEqual([FOLDER_A]);
    expect(registry.readOk()).toBe(true);
  });

  it("keeps the last-known folders and clears readOk when every read fails", async () => {
    const store = memoryStore();
    withFolders(store, [FOLDER_A, FOLDER_B]);
    const registry = createFolderRegistry({ store, id: "test" });

    // Prime the registry with a successful read.
    expect(await registry.readFolders()).toEqual([FOLDER_A, FOLDER_B]);

    // Now make every attempt of the next read throw — the registry must keep
    // what it last knew rather than collapsing to an empty list, and report the
    // read as not-OK so the load won't memoize it.
    store.failReads.set(FOLDERS_FILE_NAME, 99);
    expect(await registry.readFolders()).toEqual([FOLDER_A, FOLDER_B]);
    expect(registry.readOk()).toBe(false);
  });

  it("treats malformed sidecar JSON as no folders", async () => {
    const store = memoryStore();
    store.files.set(FOLDERS_FILE_NAME, { text: "{not json", rev: 1 });
    const registry = createFolderRegistry({ store, id: "test" });

    expect(await registry.readFolders()).toEqual([]);
    expect(registry.readOk()).toBe(true);
  });

  it("persists the registry only when it changed", async () => {
    const store = memoryStore();
    const registry = createFolderRegistry({ store, id: "test" });

    // A folder-less document that never had a sidecar writes nothing.
    await registry.persistFolders({ notes: [], folders: [] });
    expect(store.writes).toEqual([]);

    // A document with folders writes the sidecar once.
    await registry.persistFolders({ notes: [], folders: [FOLDER_A] });
    expect(store.writes).toEqual([FOLDERS_FILE_NAME]);
    expect(store.files.get(FOLDERS_FILE_NAME)?.text).toBe(
      serializeFolders([FOLDER_A]),
    );

    // An unchanged registry skips the rewrite.
    await registry.persistFolders({ notes: [], folders: [FOLDER_A] });
    expect(store.writes).toEqual([FOLDERS_FILE_NAME]);

    // Clearing the folders writes `[]` to empty the sidecar.
    await registry.persistFolders({ notes: [], folders: [] });
    expect(store.writes).toEqual([FOLDERS_FILE_NAME, FOLDERS_FILE_NAME]);
    expect(store.files.get(FOLDERS_FILE_NAME)?.text).toBe(serializeFolders([]));
  });

  it("does nothing on a null snapshot", async () => {
    const store = memoryStore();
    const registry = createFolderRegistry({ store, id: "test" });
    await registry.persistFolders(null);
    expect(store.writes).toEqual([]);
  });

  it("resolves a folder-aware note path against the last-known registry", async () => {
    const store = memoryStore();
    const registry = createFolderRegistry({ store, id: "test" });
    const folder = createFolder("Work", 1000);
    const note = { ...createNote(1000), folderId: folder.id };

    // Before the registry knows the folder, the note resolves at the root.
    expect(registry.plaintextNotePath(note)).toBe(noteFilePath(note, []));

    // After remembering the registry, it resolves into the folder directory —
    // matching how the codec lays the note down.
    registry.rememberFolders([folder]);
    expect(registry.plaintextNotePath(note)).toBe(noteFilePath(note, [folder]));
    expect(registry.plaintextNotePath(note)).not.toBe(noteFilePath(note, []));
  });
});

describe("injectFolders", () => {
  it("folds the registry's folders into a plaintext snapshot", () => {
    const base = serialize({ notes: [createNote(1000)] });
    const folded = injectFolders(base, [FOLDER_A]);
    expect(folded).not.toBe(base);
    expect(JSON.parse(folded).folders).toEqual([FOLDER_A]);
  });

  it("leaves the text untouched when there are no folders", () => {
    const base = serialize({ notes: [createNote(1000)] });
    expect(injectFolders(base, [])).toBe(base);
  });

  it("leaves an encrypted envelope opaque", () => {
    // An AES-GCM envelope is tagged `encrypted: "notes.encrypted.v1"`; the fold
    // must recognise it and not try to parse it as a plaintext snapshot.
    const envelope = JSON.stringify({
      encrypted: "notes.encrypted.v1",
      iv: "x",
      ct: "y",
    });
    expect(injectFolders(envelope, [FOLDER_A])).toBe(envelope);
  });
});
