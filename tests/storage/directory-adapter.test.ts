import { describe, expect, it } from "vitest";

import { createNote, type Note } from "../../src/domain/note.ts";
import { ConflictError } from "../../src/storage/adapter.ts";
import {
  BLOB_FILE_NAME,
  createDirectoryAdapter,
} from "../../src/storage/directory-adapter.ts";
import type { FileEntry, FileStore } from "../../src/storage/file-store.ts";
import { parse, serialize } from "../../src/storage/serialize.ts";

// In-memory FileStore: each write bumps a global counter used as the file's
// revision, so the directory adapter's aggregate-revision drift detection has
// something to move.
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
      files.set(path, { text, rev: ++counter });
    },
    async remove(path) {
      files.delete(path);
    },
  };
}

function adapter(store: FileStore) {
  return createDirectoryAdapter(store, { id: "folder", label: "Test" });
}

function notes(): Note[] {
  return [createNote(1), createNote(2)];
}

describe("directory adapter", () => {
  it("writes one markdown file per note and reads them back", async () => {
    const store = memoryStore();
    const a = adapter(store);
    const snapshot = { notes: notes() };
    await a.save(serialize(snapshot));

    const paths = (await store.list()).map((e) => e.path).sort();
    expect(paths.every((p) => p.endsWith(".md"))).toBe(true);
    expect(paths).toHaveLength(2);

    const loaded = await a.load();
    expect(parse(loaded?.text).notes).toEqual(snapshot.notes);
  });

  it("deletes the file for a removed note on the next save", async () => {
    const store = memoryStore();
    const a = adapter(store);
    const [first, second] = notes();
    await a.save(serialize({ notes: [first!, second!] }));
    await a.save(serialize({ notes: [first!] }));
    expect(await store.list()).toHaveLength(1);
  });

  it("raises ConflictError when the directory moved past the base revision", async () => {
    const store = memoryStore();
    const a = adapter(store);
    const stored = await a.save(serialize({ notes: notes() }));
    // A second writer bumps a file behind our back.
    await store.write("intruder.md", "---\nid: z\ncreated: 1\n---\nhi\n");
    await expect(
      a.save(serialize({ notes: [] }), stored.revision),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("stores an encrypted envelope as a single blob and clears the markdown", async () => {
    const store = memoryStore();
    const a = adapter(store);
    await a.save(serialize({ notes: notes() }));
    const envelope = JSON.stringify({ encrypted: "notes.encrypted.v1" });
    await a.save(envelope);

    const paths = (await store.list()).map((e) => e.path);
    expect(paths).toEqual([BLOB_FILE_NAME]);
    expect((await a.load())?.text).toBe(envelope);
  });

  it("returns null when nothing is stored", async () => {
    expect(await adapter(memoryStore()).load()).toBeNull();
  });
});
