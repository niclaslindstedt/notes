import { describe, expect, it } from "vitest";

import {
  activeNotes,
  archivedNotes,
  createNote,
  editNote,
  isBlank,
  noteTitle,
  notePreview,
  retitleNote,
  setArchived,
  sortByUpdated,
} from "../../src/domain/note.ts";

describe("note domain", () => {
  it("creates a blank note stamped at the given time", () => {
    const note = createNote(1000);
    expect(note.title).toBe("");
    expect(note.body).toBe("");
    expect(note.createdAt).toBe(1000);
    expect(note.updatedAt).toBe(1000);
    expect(isBlank(note)).toBe(true);
  });

  it("shows the title field, trimmed, and previews the whole body", () => {
    const titled = retitleNote(createNote(0), "  Hello world  ", 1);
    const note = editNote(titled, "first\nmore", 2);
    expect(noteTitle(note)).toBe("Hello world");
    expect(notePreview(note)).toBe("first more");
  });

  it("falls back to a placeholder title for a title-less note", () => {
    expect(noteTitle(createNote(0))).toBe("Untitled note");
    expect(noteTitle(editNote(createNote(0), "body only", 1))).toBe(
      "Untitled note",
    );
  });

  it("bumps updatedAt on edit / retitle without touching createdAt", () => {
    const note = editNote(createNote(100), "hi", 200);
    expect(note.createdAt).toBe(100);
    expect(note.updatedAt).toBe(200);
    expect(isBlank(note)).toBe(false);
    const renamed = retitleNote(createNote(100), "Title", 300);
    expect(renamed.createdAt).toBe(100);
    expect(renamed.updatedAt).toBe(300);
    expect(isBlank(renamed)).toBe(false);
  });

  it("archives and restores without bumping updatedAt or mutating the input", () => {
    const note = editNote(createNote(100), "hi", 200);
    const archived = setArchived(note, true);
    expect(archived.archived).toBe(true);
    expect(archived.updatedAt).toBe(200);
    expect(note.archived).toBeUndefined();
    const restored = setArchived(archived, false);
    expect(restored.archived).toBe(false);
    expect(restored.updatedAt).toBe(200);
  });

  it("partitions notes into active and archived", () => {
    const a = editNote(createNote(0), "a", 10);
    const b = setArchived(editNote(createNote(0), "b", 20), true);
    const c = editNote(createNote(0), "c", 30);
    const notes = [a, b, c];
    expect(activeNotes(notes).map((n) => n.body)).toEqual(["a", "c"]);
    expect(archivedNotes(notes).map((n) => n.body)).toEqual(["b"]);
  });

  it("sorts most-recently-edited first without mutating the input", () => {
    const a = editNote(createNote(0), "a", 10);
    const b = editNote(createNote(0), "b", 30);
    const c = editNote(createNote(0), "c", 20);
    const input = [a, b, c];
    const sorted = sortByUpdated(input);
    expect(sorted.map((n) => n.body)).toEqual(["b", "c", "a"]);
    expect(input.map((n) => n.body)).toEqual(["a", "b", "c"]);
  });
});
