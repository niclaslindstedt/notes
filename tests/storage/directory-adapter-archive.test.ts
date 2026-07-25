// The `archived/` directory: an archived note's file is filed under
// `archived/` on every file/cloud backend, in both the plaintext and the
// encrypted representation, and archiving a note whose body was never loaded
// moves its bytes rather than dropping them.

import { describe, expect, it } from "vitest";

import { createNote, setArchived, type Note } from "../../src/domain/note.ts";
import { createDirectoryAdapter } from "../../src/storage/directory-adapter.ts";
import type { FileEntry, FileStore } from "../../src/storage/file-store.ts";
import {
  ARCHIVED_DIR,
  noteFileStem,
  noteFilePath,
} from "../../src/storage/markdown/codec.ts";
import { parse, serialize } from "../../src/storage/serialize.ts";

function memoryStore(): FileStore & { paths(): string[] } {
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
    paths: () => [...files.keys()].sort(),
  };
}

function adapter(store: FileStore, password?: string) {
  return createDirectoryAdapter(
    store,
    { id: "folder", label: "Test" },
    undefined,
    password ? { passwordRef: { current: password } } : undefined,
  );
}

const body = (note: Note, text: string): Note => ({ ...note, body: text });

describe("archived notes on disk", () => {
  it("files an archived note under archived/ and an active one at the root", async () => {
    const store = memoryStore();
    const a = adapter(store);
    const active = body(createNote(1), "still current");
    const old = setArchived(body(createNote(2), "put away"), true);

    await a.save(serialize({ notes: [active, old] }));

    expect(store.paths()).toEqual([
      `${ARCHIVED_DIR}/${noteFileStem(old)}.md`,
      `${noteFileStem(active)}.md`,
    ]);
  });

  it("nests an archived note that belongs to a folder under archived/", () => {
    const folder = { id: "f1", name: "Recipes", createdAt: 1 };
    const note = setArchived({ ...createNote(1), folderId: "f1" }, true);
    expect(noteFilePath(note, [folder])).toBe(
      `${ARCHIVED_DIR}/recipes/${noteFileStem(note)}.md`,
    );
  });

  it("moves the file when a note is archived, and back when restored", async () => {
    const store = memoryStore();
    const a = adapter(store);
    const note = body(createNote(1), "hello");
    const stem = noteFileStem(note);

    const first = await a.save(serialize({ notes: [note] }));
    expect(store.paths()).toEqual([`${stem}.md`]);

    const archived = setArchived(note, true);
    const second = await a.save(
      serialize({ notes: [archived] }),
      first.revision,
    );
    expect(store.paths()).toEqual([`${ARCHIVED_DIR}/${stem}.md`]);

    await a.save(
      serialize({ notes: [setArchived(archived, false)] }),
      second.revision,
    );
    expect(store.paths()).toEqual([`${stem}.md`]);
  });

  it("round-trips an archived note's body and flag through the archive directory", async () => {
    const store = memoryStore();
    const a = adapter(store);
    const note = setArchived(body(createNote(1), "kept text"), true);

    await a.save(serialize({ notes: [note] }));
    const loaded = parse((await a.load())?.text);

    expect(loaded.notes).toHaveLength(1);
    expect(loaded.notes[0]?.archived).toBe(true);
    expect(loaded.notes[0]?.body).toBe("kept text");
  });

  it("adopts an archived note left at the notes root by an older build", async () => {
    const store = memoryStore();
    const note = setArchived(body(createNote(1), "legacy placement"), true);
    const stem = noteFileStem(note);
    // Exactly what the pre-`archived/` layout wrote: flat at the notes root,
    // with the archived flag in the frontmatter.
    await store.write(
      `${stem}.md`,
      `---\nid: ${note.id}\ncreated: 1\nupdated: 1\narchived: true\n---\n\nlegacy placement\n`,
    );

    const a = adapter(store);
    const loaded = await a.load();
    expect(parse(loaded?.text).notes[0]?.archived).toBe(true);

    // The next save relocates it without the user doing anything.
    await a.save(loaded!.text, loaded?.revision);
    expect(store.paths()).toEqual([`${ARCHIVED_DIR}/${stem}.md`]);
  });

  describe("encrypted representation", () => {
    it("files an archived note's .enc under archived/", async () => {
      const store = memoryStore();
      const a = adapter(store, "pw");
      const active = body(createNote(1), "current");
      const old = setArchived(body(createNote(2), "archived"), true);

      await a.save(serialize({ notes: [active, old] }));

      const encPaths = store.paths().filter((p) => p.endsWith(".enc"));
      expect(encPaths).toHaveLength(2);
      expect(
        encPaths.filter((p) => p.startsWith(`${ARCHIVED_DIR}/`)),
      ).toHaveLength(1);
    });

    it("keeps a deferred note's ciphertext when it is archived", async () => {
      // The regression this guards: a note archived on a device that never
      // opened it has no body in memory, so the save has nothing to write —
      // and the old path is tracked but unwanted, so a naive planner would
      // delete the only copy.
      const store = memoryStore();
      const first = adapter(store, "pw");
      const note = body(createNote(1), "text that only exists on disk");
      await first.save(serialize({ notes: [note] }));

      // A fresh adapter loads from the index, so the note comes back deferred.
      const second = adapter(store, "pw");
      const loaded = await second.load();
      const deferred = parse(loaded?.text).notes[0]!;
      expect(deferred.body).toBeUndefined();

      await second.save(
        serialize({ notes: [setArchived(deferred, true)] }),
        loaded?.revision,
      );

      const encPaths = store.paths().filter((p) => p.endsWith(".enc"));
      expect(encPaths).toHaveLength(1);
      expect(encPaths[0]!.startsWith(`${ARCHIVED_DIR}/`)).toBe(true);

      // And the body survived the move intact.
      const third = adapter(store, "pw");
      const reloaded = parse((await third.load())?.text).notes[0]!;
      expect(await third.fetchNoteBody!(reloaded)).toBe(
        "text that only exists on disk",
      );
    });
  });
});
