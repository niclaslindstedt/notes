// Orphan files: things in the notes folder the app can't match to a note.
//
// The property that matters most here is the *negative* one — a save must not
// delete them. Before orphans were tracked, a hand-authored `.md` dropped into
// a synced folder was listed, tracked, absent from the desired set, and
// therefore removed by the next unrelated save.

import { describe, expect, it } from "vitest";

import { createNote, type Note } from "../../src/domain/note.ts";
import { createDirectoryAdapter } from "../../src/storage/directory-adapter.ts";
import type { FileEntry, FileStore } from "../../src/storage/file-store.ts";
import { noteFileStem } from "../../src/storage/markdown/codec.ts";
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

function adapter(store: FileStore) {
  return createDirectoryAdapter(store, { id: "folder", label: "Test" });
}

const withBody = (note: Note, text: string): Note => ({ ...note, body: text });

describe("orphan files", () => {
  it("reports a markdown file with no note frontmatter as unreadable", async () => {
    const store = memoryStore();
    await store.write("shopping.md", "# Shopping\n\n- milk\n");
    const a = adapter(store);

    await a.load();

    expect(a.getOrphans!()).toEqual([
      { path: "shopping.md", reason: "unreadable" },
    ]);
  });

  it("reports a file whose type the app doesn't store notes in as foreign", async () => {
    const store = memoryStore();
    await store.write("budget.csv", "a,b\n1,2\n");
    const a = adapter(store);

    await a.load();

    expect(a.getOrphans!()).toEqual([
      { path: "budget.csv", reason: "foreign" },
    ]);
  });

  it("does not report the sidecars it writes itself, nor dotfiles", async () => {
    const store = memoryStore();
    await store.write("folders.json", "[]");
    await store.write(".keyparams.json", "{}");
    await store.write(".DS_Store", "junk");
    const a = adapter(store);

    await a.load();

    expect(a.getOrphans!()).toEqual([]);
  });

  it("leaves an orphan untouched across an unrelated save", async () => {
    const store = memoryStore();
    await store.write("readme.md", "notes about my notes\n");
    const a = adapter(store);

    const loaded = await a.load();
    // Save a real note alongside it — the orphan is tracked but unwanted, the
    // exact shape that used to get it deleted.
    const note = withBody(createNote(1), "a genuine note");
    await a.save(serialize({ notes: [note] }), loaded?.revision);

    expect(store.paths()).toContain("readme.md");
    expect(await store.read("readme.md")).toBe("notes about my notes\n");
  });

  it("still deletes the file of a note that was genuinely removed", async () => {
    // The guard above must not blunt real deletions.
    const store = memoryStore();
    const a = adapter(store);
    const keep = withBody(createNote(1), "keep");
    const drop = withBody(createNote(2), "drop");

    const first = await a.save(serialize({ notes: [keep, drop] }));
    await a.save(serialize({ notes: [keep] }), first.revision);

    expect(store.paths()).toEqual([`${noteFileStem(keep)}.md`]);
  });

  it("removes an orphan only through removeOrphan, and stops reporting it", async () => {
    const store = memoryStore();
    await store.write("stray.md", "nothing to see");
    const a = adapter(store);
    await a.load();

    await a.removeOrphan!("stray.md");

    expect(store.paths()).toEqual([]);
    expect(a.getOrphans!()).toEqual([]);
  });

  it("refuses to read or remove a path the last load didn't report", async () => {
    // `readOrphan` / `removeOrphan` are scoped to the reported set so they
    // can't be turned into a general read/delete of anything under the root.
    const store = memoryStore();
    const a = adapter(store);
    const note = withBody(createNote(1), "private");
    await a.save(serialize({ notes: [note] }));
    await a.load();

    const notePath = `${noteFileStem(note)}.md`;
    expect(await a.readOrphan!(notePath)).toBeNull();
    await a.removeOrphan!(notePath);
    expect(store.paths()).toContain(notePath);
  });

  it("reads an orphan's text so it can be previewed and adopted", async () => {
    const store = memoryStore();
    await store.write("recipe.md", "# Soup\n\nboil water\n");
    const a = adapter(store);
    await a.load();

    expect(await a.readOrphan!("recipe.md")).toBe("# Soup\n\nboil water\n");
  });

  it("keeps loading the real notes when an unreadable file sits beside them", async () => {
    const store = memoryStore();
    const a = adapter(store);
    const note = withBody(createNote(1), "a genuine note");
    await a.save(serialize({ notes: [note] }));
    await store.write("hand-written.md", "no frontmatter here");

    const fresh = adapter(store);
    const loaded = await fresh.load();

    expect(parse(loaded?.text).notes).toHaveLength(1);
    expect(fresh.getOrphans!()).toEqual([
      { path: "hand-written.md", reason: "unreadable" },
    ]);
  });

  it("advertises the orphans capability", () => {
    expect(adapter(memoryStore()).capabilities.has("orphans")).toBe(true);
  });
});
