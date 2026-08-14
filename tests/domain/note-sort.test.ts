import { describe, expect, it } from "vitest";

import {
  DEFAULT_NOTE_SORT_KEY,
  folderModifiedAt,
  isNoteSortKey,
  mixTopLevel,
  NOTE_SORT_KEYS,
  recentNotesBy,
  sortFoldersBy,
  sortNotesBy,
  type Folder,
  type Note,
} from "../../src/domain/note.ts";

function note(over: Partial<Note> & { id: string }): Note {
  return {
    title: "",
    body: "",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function folder(over: Partial<Folder> & { id: string }): Folder {
  return { name: "", createdAt: 0, ...over };
}

describe("sort-key preference", () => {
  it("recognises only the known keys", () => {
    expect(isNoteSortKey("modified")).toBe(true);
    expect(isNoteSortKey("name")).toBe(true);
    expect(isNoteSortKey("created")).toBe(false);
    expect(isNoteSortKey(undefined)).toBe(false);
  });

  it("defaults to last-modified and enumerates both keys", () => {
    expect(DEFAULT_NOTE_SORT_KEY).toBe("modified");
    expect([...NOTE_SORT_KEYS]).toEqual(["modified", "name"]);
  });
});

describe("sortNotesBy", () => {
  const a = note({ id: "a", title: "banana", updatedAt: 30 });
  const b = note({ id: "b", title: "Apple", updatedAt: 10 });
  const c = note({ id: "c", title: "cherry", updatedAt: 20 });

  it("sorts most-recently-edited first under `modified`", () => {
    expect(sortNotesBy([b, a, c], "modified").map((n) => n.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("sorts case-insensitively by title under `name`", () => {
    expect(sortNotesBy([a, b, c], "name").map((n) => n.id)).toEqual([
      "b", // "Apple" — uppercase must not sort before lowercase
      "a", // "banana"
      "c", // "cherry"
    ]);
  });

  it("never mutates the input", () => {
    const input = [a, b, c];
    sortNotesBy(input, "name");
    expect(input.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });
});

describe("recentNotesBy", () => {
  // Titled so alphabetical order is the exact reverse of edit order: the newest
  // note sorts last by name, which is what the drawer used to drop.
  const older = [
    note({ id: "1", title: "alpha", updatedAt: 50 }),
    note({ id: "2", title: "bravo", updatedAt: 40 }),
    note({ id: "3", title: "charlie", updatedAt: 30 }),
  ];
  const fresh = note({ id: "new", title: "zulu", updatedAt: 99 });

  it("keeps a just-created note in the window under `name`", () => {
    // The regression: sorting by name and slicing after picked the
    // alphabetically-first notes, so a new note titled late in the alphabet
    // never reached the side menu even though the overview listed it on top.
    const kept = recentNotesBy([...older, fresh], "name", 2);
    expect(kept.map((n) => n.id)).toContain("new");
  });

  it("selects by recency, then orders that window by the key", () => {
    const kept = recentNotesBy([...older, fresh], "name", 2);
    // The two newest are "zulu" (99) and "alpha" (50), displayed alphabetically.
    expect(kept.map((n) => n.id)).toEqual(["1", "new"]);
  });

  it("orders the same window newest-first under `modified`", () => {
    const kept = recentNotesBy([...older, fresh], "modified", 2);
    expect(kept.map((n) => n.id)).toEqual(["new", "1"]);
  });

  it("returns every note when the limit exceeds the list", () => {
    expect(recentNotesBy(older, "name", 10).map((n) => n.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("never mutates the input", () => {
    const input = [...older, fresh];
    recentNotesBy(input, "name", 2);
    expect(input.map((n) => n.id)).toEqual(["1", "2", "3", "new"]);
  });
});

describe("folderModifiedAt", () => {
  const f = folder({ id: "f", createdAt: 100 });

  it("returns the newest filed note's updatedAt", () => {
    const notes = [
      note({ id: "1", folderId: "f", updatedAt: 250 }),
      note({ id: "2", folderId: "f", updatedAt: 400 }),
      note({ id: "3", folderId: "other", updatedAt: 999 }),
    ];
    expect(folderModifiedAt(f, notes)).toBe(400);
  });

  it("falls back to the folder's own creation time when empty", () => {
    expect(folderModifiedAt(f, [])).toBe(100);
    expect(
      folderModifiedAt(f, [note({ id: "x", folderId: "other", updatedAt: 5 })]),
    ).toBe(100);
  });

  it("never lets an older note pull the time below createdAt", () => {
    expect(
      folderModifiedAt(f, [note({ id: "1", folderId: "f", updatedAt: 50 })]),
    ).toBe(100);
  });
});

describe("sortFoldersBy", () => {
  const work = folder({ id: "work", name: "Work", createdAt: 0 });
  const recipes = folder({ id: "recipes", name: "recipes", createdAt: 0 });
  const notes = [
    note({ id: "n1", folderId: "work", updatedAt: 10 }),
    note({ id: "n2", folderId: "recipes", updatedAt: 90 }),
  ];

  it("sorts case-insensitively by name under `name`", () => {
    expect(
      sortFoldersBy([work, recipes], notes, "name").map((f) => f.id),
    ).toEqual(["recipes", "work"]);
  });

  it("sorts by each folder's newest note under `modified`", () => {
    expect(
      sortFoldersBy([work, recipes], notes, "modified").map((f) => f.id),
    ).toEqual(["recipes", "work"]);
  });

  it("never mutates the input", () => {
    const input = [work, recipes];
    sortFoldersBy(input, notes, "name");
    expect(input.map((f) => f.id)).toEqual(["work", "recipes"]);
  });
});

describe("mixTopLevel", () => {
  const fApple = folder({ id: "fa", name: "Apple", createdAt: 0 });
  const loose = note({ id: "z", title: "Zebra", updatedAt: 500 });
  const allNotes = [
    note({ id: "in-fa", folderId: "fa", updatedAt: 100 }),
    loose,
  ];

  it("interleaves folders and loose notes alphabetically under `name`", () => {
    const out = mixTopLevel([fApple], [loose], allNotes, "name");
    expect(
      out.map((i) => (i.kind === "folder" ? i.folder.id : i.note.id)),
    ).toEqual(["fa", "z"]); // "Apple" < "Zebra"
  });

  it("interleaves by recency under `modified`, using the folder's newest note", () => {
    // folder fa's modified time is 100 (its filed note); the loose note is 500,
    // so the loose note sorts first.
    const out = mixTopLevel([fApple], [loose], allNotes, "modified");
    expect(
      out.map((i) => (i.kind === "folder" ? i.folder.id : i.note.id)),
    ).toEqual(["z", "fa"]);
  });
});
