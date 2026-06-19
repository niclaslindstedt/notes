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
// something to move. `write` returns the new revision, mirroring the real
// backends, so the adapter builds the post-save revision without re-listing.
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

  it("reads the directory only once per save (no post-write re-list)", async () => {
    // The post-save revision must come from the write responses, not a second
    // list() — re-listing is what made the cloud backends stamp a stale,
    // eventually-consistent revision the next save misread as a remote edit.
    const real = memoryStore();
    let lists = 0;
    const store: FileStore = {
      async list() {
        lists += 1;
        return real.list();
      },
      read: (p) => real.read(p),
      write: (p, t) => real.write(p, t),
      remove: (p) => real.remove(p),
    };
    const a = adapter(store);
    const stored = await a.save(serialize({ notes: notes() }));
    expect(lists).toBe(1);
    // And the revision it reported is the one a fresh listing now agrees with,
    // so the next save bases on a matching baseline.
    await expect(
      a.save(serialize({ notes: [] }), stored.revision),
    ).resolves.toBeDefined();
  });

  it("tolerates a listing that lags this device's own recent write", async () => {
    // Cloud list endpoints are eventually consistent: right after a write,
    // list() can still report the previous directory state. A queued back-to-
    // back save then lists that stale state — but it's one *this* adapter just
    // produced, so it must be treated as our own lag, not another device.
    const real = memoryStore();
    const history: FileEntry[][] = [];
    let lag = false;
    const store: FileStore = {
      async list() {
        const current = await real.list();
        history.push(current);
        // While lagging, reveal the directory as it was one listing ago.
        return lag && history.length >= 2
          ? history[history.length - 2]!
          : current;
      },
      read: (p) => real.read(p),
      write: (p, t) => real.write(p, t),
      remove: (p) => real.remove(p),
    };
    const a = adapter(store);

    const s1 = await a.save(serialize({ notes: [createNote(1)] }));
    const s2 = await a.save(
      serialize({ notes: [createNote(1), createNote(2)] }),
      s1.revision,
    );
    // From here the listing trails the real directory by one step.
    lag = true;
    await expect(
      a.save(serialize({ notes: [createNote(1)] }), s2.revision),
    ).resolves.toBeDefined();
  });
});
