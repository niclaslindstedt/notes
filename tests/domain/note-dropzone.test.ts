import { describe, expect, it } from "vitest";

import {
  createDropzoneNote,
  dropzoneNotes,
  dropzoneTitle,
  isDropzone,
  isDropzoneNamed,
  setDropzone,
  type Note,
} from "../../src/domain/note.ts";

// 2025-03-04 17:09 local time — the exact clock reading doesn't matter, only
// that the title the note is born with is derived from it.
const MADE_AT = new Date(2025, 2, 4, 17, 9).getTime();

function dropzone(overrides: Partial<Note> = {}): Note {
  return { ...createDropzoneNote(MADE_AT), ...overrides };
}

describe("dropzone notes", () => {
  it("is born named after the moment it was made", () => {
    const note = createDropzoneNote(MADE_AT);
    expect(note.title).toBe("2025-03-04 17:09");
    expect(note.title).toBe(dropzoneTitle(MADE_AT));
    expect(note.createdAt).toBe(MADE_AT);
    expect(note.body).toBe("");
    expect(isDropzone(note)).toBe(true);
  });

  it("does not mark an ordinary note", () => {
    const note: Note = {
      id: "n1",
      title: "Groceries",
      body: "",
      createdAt: MADE_AT,
      updatedAt: MADE_AT,
    };
    expect(isDropzone(note)).toBe(false);
    // An ordinary note that happens to be *called* a timestamp is still not a
    // dropzone note — the flag decides, never the name.
    expect(isDropzoneNamed({ ...note, title: dropzoneTitle(MADE_AT) })).toBe(
      false,
    );
  });

  it("counts as named only once the title stops being the timestamp", () => {
    expect(isDropzoneNamed(dropzone())).toBe(false);
    // Whitespace around the born-with name is not a rename.
    expect(isDropzoneNamed(dropzone({ title: "  2025-03-04 17:09  " }))).toBe(
      false,
    );
    // Nor is clearing it — an empty title is the "Untitled note" fallback, not
    // a decision to keep the note.
    expect(isDropzoneNamed(dropzone({ title: "" }))).toBe(false);
    expect(isDropzoneNamed(dropzone({ title: "Wifi password" }))).toBe(true);
  });

  it("promotes out of the dropzone by dropping the flag entirely", () => {
    const kept = setDropzone(dropzone({ title: "Wifi password" }), false);
    expect(isDropzone(kept)).toBe(false);
    expect("dropzone" in kept).toBe(false);
    expect(setDropzone(kept, true).dropzone).toBe(true);
  });

  it("leaves updatedAt alone — it says where the note is listed, not what it says", () => {
    const note = dropzone({ updatedAt: 999 });
    expect(setDropzone(note, false).updatedAt).toBe(999);
  });

  it("lists the dropzone newest first, archived ones left out", () => {
    const notes: Note[] = [
      dropzone({ id: "old", createdAt: 1, updatedAt: 500 }),
      { ...dropzone({ id: "plain" }), dropzone: undefined },
      dropzone({ id: "new", createdAt: 3, updatedAt: 4 }),
      dropzone({ id: "gone", createdAt: 2, archived: true }),
    ];
    expect(dropzoneNotes(notes).map((n) => n.id)).toEqual(["new", "old"]);
  });

  it("never mutates the list it is given", () => {
    const notes = [
      dropzone({ id: "a", createdAt: 1 }),
      dropzone({ id: "b", createdAt: 2 }),
    ];
    dropzoneNotes(notes);
    expect(notes.map((n) => n.id)).toEqual(["a", "b"]);
  });
});
