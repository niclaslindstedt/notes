import { describe, expect, it } from "vitest";

import {
  createNote,
  editNote,
  isBlank,
  noteTitle,
  notePreview,
  sortByUpdated,
} from "../../src/domain/note.ts";

describe("note domain", () => {
  it("creates a blank note stamped at the given time", () => {
    const note = createNote(1000);
    expect(note.body).toBe("");
    expect(note.createdAt).toBe(1000);
    expect(note.updatedAt).toBe(1000);
    expect(isBlank(note)).toBe(true);
  });

  it("derives the title from the first non-empty line", () => {
    const note = editNote(createNote(0), "\n  Hello world  \nmore", 1);
    expect(noteTitle(note)).toBe("Hello world");
    expect(notePreview(note)).toBe("more");
  });

  it("falls back to a placeholder title for an empty body", () => {
    expect(noteTitle(createNote(0))).toBe("Untitled note");
  });

  it("bumps updatedAt on edit without touching createdAt", () => {
    const note = editNote(createNote(100), "hi", 200);
    expect(note.createdAt).toBe(100);
    expect(note.updatedAt).toBe(200);
    expect(isBlank(note)).toBe(false);
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
