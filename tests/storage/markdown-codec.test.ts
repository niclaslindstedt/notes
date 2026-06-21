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

describe("markdown codec — folder frontmatter", () => {
  it("writes a note's folderId to frontmatter and reads it back", () => {
    const n: Note = { ...note("a", "Title", "body"), folderId: "f1" };
    const md = snapshotToFiles({ notes: [n] })[0]!.text;
    expect(md).toContain("folder: f1");
    const parsed = parseNote(md);
    expect(parsed?.folderId).toBe("f1");
  });

  it("leaves an ungrouped note's frontmatter without a folder line", () => {
    const md = snapshotToFiles({ notes: [note("a", "Title", "body")] })[0]!
      .text;
    expect(md).not.toContain("folder:");
    expect(parseNote(md)?.folderId).toBeUndefined();
  });
});

describe("markdown codec — physical folder directories", () => {
  it("files a grouped note into its folder's real subdirectory", () => {
    const n: Note = {
      ...note("abcdef123456", "Pasta", "boil"),
      folderId: "f1",
    };
    const file = snapshotToFiles({
      notes: [n],
      folders: [{ id: "f1", name: "Recipes", createdAt: 1 }],
    })[0]!;
    expect(file.path).toBe("recipes/pasta-123456.md");
    // The folder id still rides the frontmatter as the authoritative link.
    expect(file.text).toContain("folder: f1");
  });

  it("keeps an ungrouped note at the notes root", () => {
    const file = snapshotToFiles({
      notes: [note("abcdef123456", "Loose", "x")],
      folders: [{ id: "f1", name: "Recipes", createdAt: 1 }],
    })[0]!;
    expect(file.path).toBe("loose-123456.md");
  });

  it("leaves a note flat when its folder is missing from the registry", () => {
    const n: Note = {
      ...note("abcdef123456", "Orphan", "x"),
      folderId: "gone",
    };
    const file = snapshotToFiles({ notes: [n], folders: [] })[0]!;
    expect(file.path).toBe("orphan-123456.md");
  });

  it("points an attachment reference up the extra folder level on disk", () => {
    const n: Note = {
      ...note("aabbcc112233", "Holiday", "![pic](attachments/xy-pic.png)"),
      folderId: "f1",
    };
    const file = snapshotToFiles({
      notes: [n],
      folders: [{ id: "f1", name: "Travel", createdAt: 1 }],
    })[0]!;
    const stem = noteFileStem(n);
    // notes/travel/<stem>.md -> ../../attachments/<stem>/ reaches the sibling
    // attachments tree at the namespace root.
    expect(file.text).toContain(`![pic](../../attachments/${stem}/xy-pic.png)`);
    // And it collapses back to the flat in-memory form regardless of depth.
    expect(parseNote(file.text)?.body).toBe("![pic](attachments/xy-pic.png)");
  });

  it("derives a stable directory for a folder whose name slugs to nothing", () => {
    const n: Note = { ...note("abcdef123456", "X", "x"), folderId: "f9" };
    const file = snapshotToFiles({
      notes: [n],
      folders: [{ id: "f9aaaa", name: "🎉", createdAt: 1 }],
    })[0]!;
    // Folder id "f9" doesn't match "f9aaaa", so it falls back to the root —
    // but a matching all-emoji folder gets a deterministic `folder-<id>` dir.
    expect(file.path).toBe("x-123456.md");
    const matched = snapshotToFiles({
      notes: [{ ...n, folderId: "f9aaaa" }],
      folders: [{ id: "f9aaaa", name: "🎉", createdAt: 1 }],
    })[0]!;
    expect(matched.path).toBe("folder-f9aaaa/x-123456.md");
  });
});
