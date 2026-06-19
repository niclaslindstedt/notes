import { describe, expect, it } from "vitest";

import { createNote, editNote, type Note } from "../../src/domain/note.ts";
import {
  filesToSnapshot,
  noteFileStem,
  parseNote,
  snapshotToFiles,
} from "../../src/storage/markdown/codec.ts";

function note(
  id: string,
  title: string,
  body = "",
  created = 1,
  updated = 2,
): Note {
  return { id, title, body, createdAt: created, updatedAt: updated };
}

describe("markdown codec", () => {
  it("round-trips a snapshot through files and back", () => {
    const snapshot = {
      notes: [
        note("11111111", "Groceries", "milk\neggs", 100, 200),
        note("22222222", "Trip ideas", "Kyoto", 300, 400),
      ],
    };
    const files = snapshotToFiles(snapshot);
    const restored = filesToSnapshot(files);
    expect(restored.notes).toEqual(snapshot.notes);
  });

  it("carries the title through the frontmatter, not the body", () => {
    const file = snapshotToFiles({
      notes: [note("abc", "My title", "the body")],
    })[0]!;
    expect(file.text).toContain("title: My title");
    const parsed = parseNote(file.text);
    expect(parsed?.title).toBe("My title");
    expect(parsed?.body).toBe("the body");
  });

  it("rewrites image references to the on-disk sibling layout and back", () => {
    const n = note(
      "aabbcc112233",
      "Holiday",
      "before\n![pic](attachments/xy-pic.png)\nafter",
    );
    const file = snapshotToFiles({ notes: [n] })[0]!;
    const stem = noteFileStem(n);
    // On disk the note sits in notes/<stem>.md and the image in the sibling
    // attachments/<stem>/, so the reference points up-and-over.
    expect(file.text).toContain(`![pic](../attachments/${stem}/xy-pic.png)`);
    // Coming back, the reference collapses to the rename-proof flat form.
    expect(parseNote(file.text)?.body).toBe(
      "before\n![pic](attachments/xy-pic.png)\nafter",
    );
  });

  it("round-trips the archived flag through the frontmatter", () => {
    const archived: Note = { ...note("arch1", "Old", "body"), archived: true };
    const file = snapshotToFiles({ notes: [archived] })[0]!;
    expect(file.text).toContain("archived: true");
    expect(parseNote(file.text)?.archived).toBe(true);
    // An active note never writes the flag, and parses back without it.
    const active = snapshotToFiles({
      notes: [note("act1", "New", "body")],
    })[0]!;
    expect(active.text).not.toContain("archived");
    expect(parseNote(active.text)?.archived).toBeUndefined();
  });

  it("derives a slug-of-title filename suffixed with the id tail", () => {
    const stem = noteFileStem(note("abcdef123456", "My First Note"));
    expect(stem).toBe("my-first-note-123456");
    expect(
      snapshotToFiles({ notes: [note("abcdef123456", "Hi there")] })[0]!.path,
    ).toBe("hi-there-123456.md");
  });

  it("falls back to a stable stem for a title-less note", () => {
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
