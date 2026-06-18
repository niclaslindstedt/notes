import { describe, expect, it } from "vitest";

import { createNote, editNote, type Note } from "../../src/domain/note.ts";
import {
  filesToSnapshot,
  noteFileStem,
  parseNote,
  snapshotToFiles,
} from "../../src/storage/markdown/codec.ts";

function note(id: string, body: string, created = 1, updated = 2): Note {
  return { id, body, createdAt: created, updatedAt: updated };
}

describe("markdown codec", () => {
  it("round-trips a snapshot through files and back", () => {
    const snapshot = {
      notes: [
        note("11111111", "Groceries\nmilk\neggs", 100, 200),
        note("22222222", "Trip ideas\nKyoto", 300, 400),
      ],
    };
    const files = snapshotToFiles(snapshot);
    const restored = filesToSnapshot(files);
    expect(restored.notes).toEqual(snapshot.notes);
  });

  it("derives a slug-of-title filename suffixed with the id tail", () => {
    const stem = noteFileStem(note("abcdef123456", "My First Note"));
    expect(stem).toBe("my-first-note-123456.md".replace(/\.md$/, ""));
    expect(
      snapshotToFiles({ notes: [note("abcdef123456", "Hi there")] })[0]!.path,
    ).toBe("hi-there-123456.md");
  });

  it("falls back to a stable stem for a blank note", () => {
    expect(noteFileStem(createNote(0)).startsWith("note-")).toBe(true);
  });

  it("preserves the body verbatim (minus the trailing newline) on parse", () => {
    const n = editNote(createNote(0), "Line one\n\nLine three", 1);
    const file = snapshotToFiles({ notes: [n] })[0]!;
    expect(parseNote(file.text)?.body).toBe("Line one\n\nLine three");
  });

  it("skips a file with no frontmatter / id rather than failing the load", () => {
    const good = snapshotToFiles({ notes: [note("aaa111", "Keep me")] })[0]!;
    const result = filesToSnapshot([
      { path: "junk.md", text: "no frontmatter here" },
      good,
    ]);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]!.id).toBe("aaa111");
  });
});
