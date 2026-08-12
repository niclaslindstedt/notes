import { describe, expect, it } from "vitest";

import {
  favoriteNotes,
  groupFavoritesByFolder,
  setFavorite,
  type Folder,
  type Note,
} from "../../src/domain/note.ts";

function note(id: string, over: Partial<Note> = {}): Note {
  return {
    id,
    title: id,
    body: "",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

const WORK: Folder = { id: "f1", name: "Work", createdAt: 1 };
const TRIP: Folder = { id: "f2", name: "Trip", createdAt: 2 };

describe("setFavorite", () => {
  it("stars a note without touching updatedAt", () => {
    const before = note("a", { updatedAt: 42 });
    const after = setFavorite(before, true);
    expect(after.favorite).toBe(true);
    expect(after.updatedAt).toBe(42);
    expect(before.favorite).toBeUndefined();
  });

  it("drops the flag entirely when unstarring, rather than writing false", () => {
    const after = setFavorite(note("a", { favorite: true }), false);
    expect("favorite" in after).toBe(false);
  });
});

describe("favoriteNotes", () => {
  it("keeps only the starred notes, in the given order", () => {
    const notes = [
      note("a", { favorite: true }),
      note("b"),
      note("c", { favorite: true }),
    ];
    expect(favoriteNotes(notes).map((n) => n.id)).toEqual(["a", "c"]);
  });

  it("drops a starred note that has been archived", () => {
    const notes = [note("a", { favorite: true, archived: true }), note("b")];
    expect(favoriteNotes(notes)).toEqual([]);
  });
});

describe("groupFavoritesByFolder", () => {
  it("groups by folder and puts the ungrouped run last", () => {
    const favorites = [
      note("loose", { favorite: true }),
      note("filed", { favorite: true, folderId: WORK.id }),
    ];
    const groups = groupFavoritesByFolder(favorites, [WORK], "name");
    expect(groups.map((g) => g.folder?.name ?? null)).toEqual(["Work", null]);
    expect(groups[0]!.notes.map((n) => n.id)).toEqual(["filed"]);
    expect(groups[1]!.notes.map((n) => n.id)).toEqual(["loose"]);
  });

  it("omits a folder that holds no favorite", () => {
    const favorites = [note("filed", { favorite: true, folderId: WORK.id })];
    const groups = groupFavoritesByFolder(favorites, [WORK, TRIP], "name");
    expect(groups.map((g) => g.folder?.name)).toEqual(["Work"]);
  });

  it("omits the ungrouped run when every favorite is filed", () => {
    const favorites = [note("filed", { favorite: true, folderId: WORK.id })];
    expect(groupFavoritesByFolder(favorites, [WORK], "name")).toHaveLength(1);
  });

  it("treats a stale folder link as ungrouped", () => {
    const favorites = [note("orphan", { favorite: true, folderId: "gone" })];
    const groups = groupFavoritesByFolder(favorites, [WORK], "name");
    expect(groups.map((g) => g.folder)).toEqual([null]);
    expect(groups[0]!.notes.map((n) => n.id)).toEqual(["orphan"]);
  });

  it("sorts folders by their newest favorite under the modified key", () => {
    const favorites = [
      note("old", { favorite: true, folderId: WORK.id, updatedAt: 10 }),
      note("new", { favorite: true, folderId: TRIP.id, updatedAt: 20 }),
    ];
    const groups = groupFavoritesByFolder(favorites, [WORK, TRIP], "modified");
    expect(groups.map((g) => g.folder?.name)).toEqual(["Trip", "Work"]);
  });
});
