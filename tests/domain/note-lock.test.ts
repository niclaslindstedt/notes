import { describe, expect, it } from "vitest";

import { isLocked, setLocked, type Note } from "../../src/domain/note.ts";

function note(over: Partial<Note> = {}): Note {
  return {
    id: "n1",
    title: "n1",
    body: "",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe("setLocked", () => {
  it("locks a note without touching updatedAt", () => {
    const before = note({ updatedAt: 42 });
    const after = setLocked(before, true);
    expect(after.locked).toBe(true);
    expect(after.updatedAt).toBe(42);
    // The input is never mutated.
    expect(before.locked).toBeUndefined();
  });

  it("drops the flag entirely when unlocking, rather than writing false", () => {
    const after = setLocked(note({ locked: true }), false);
    expect("locked" in after).toBe(false);
  });

  it("leaves the note's own content alone", () => {
    const before = note({ body: "text", title: "Name", favorite: true });
    const after = setLocked(before, true);
    expect(after.body).toBe("text");
    expect(after.title).toBe("Name");
    expect(after.favorite).toBe(true);
  });
});

describe("isLocked", () => {
  it("answers only for a note carrying the flag", () => {
    expect(isLocked(note())).toBe(false);
    expect(isLocked(note({ locked: true }))).toBe(true);
  });
});
