import { describe, expect, it } from "vitest";

import type { LineComment } from "../../src/domain/note-comment.ts";
import type { Note } from "../../src/domain/note.ts";
import { noteToMarkdown, parseNote } from "../../src/storage/markdown/codec.ts";

function comment(over: Partial<LineComment> = {}): LineComment {
  return {
    id: "c1",
    lines: [2],
    text: "Needs a source",
    createdAt: 10,
    updatedAt: 20,
    ...over,
  };
}

function note(over: Partial<Note> = {}): Note {
  return {
    id: "n1",
    title: "Title",
    body: "one\ntwo\nthree",
    createdAt: 1,
    updatedAt: 2,
    ...over,
  };
}

describe("line comments in the markdown frontmatter", () => {
  it("writes a block sequence with one-based line numbers", () => {
    const text = noteToMarkdown(note({ comments: [comment()] }));
    expect(text).toContain(
      [
        "comments:",
        "  - lines: 3",
        '    text: "Needs a source"',
        "    id: c1",
        "    created: 10",
        "    updated: 20",
      ].join("\n"),
    );
    // Still one frontmatter block, and the body is untouched below it.
    expect(text.endsWith("---\n\none\ntwo\nthree\n")).toBe(true);
  });

  it("leaves the frontmatter untouched on a note with no comments", () => {
    expect(noteToMarkdown(note())).not.toContain("comments:");
  });

  it("round-trips comments through the file", () => {
    const before = note({
      comments: [comment(), comment({ id: "c2", lines: [0, 1], text: "hi" })],
    });
    const after = parseNote(noteToMarkdown(before));
    expect(after?.comments).toEqual([
      comment({ id: "c2", lines: [0, 1], text: "hi" }),
      comment(),
    ]);
    expect(after?.body).toBe(before.body);
  });

  it("round-trips a comment carrying a colon, a quote, or a newline", () => {
    const text = 'note: "why" — see\nthe next line\n---';
    const after = parseNote(
      noteToMarkdown(note({ comments: [comment({ text })] })),
    );
    expect(after?.comments?.[0]?.text).toBe(text);
    expect(after?.body).toBe("one\ntwo\nthree");
  });

  it("reads a comment somebody wrote by hand, minting the missing id", () => {
    const parsed = parseNote(
      [
        "---",
        "id: n1",
        "created: 1",
        "updated: 2",
        "comments:",
        "  - lines: 2-3",
        "    text: check this",
        "---",
        "",
        "one\ntwo\nthree",
        "",
      ].join("\n"),
    );
    expect(parsed?.comments).toHaveLength(1);
    expect(parsed?.comments?.[0]?.lines).toEqual([1, 2]);
    expect(parsed?.comments?.[0]?.text).toBe("check this");
    expect(parsed?.comments?.[0]?.id).toBeTruthy();
  });

  it("drops a mangled entry but keeps the note and its other comments", () => {
    const parsed = parseNote(
      [
        "---",
        "id: n1",
        "created: 1",
        "updated: 2",
        "comments:",
        "  - lines: nonsense",
        '    text: "gone"',
        "  - lines: 1",
        '    text: "kept"',
        '  - text: "no anchor"',
        "title: Title",
        "---",
        "",
        "one",
        "",
      ].join("\n"),
    );
    expect(parsed?.title).toBe("Title");
    expect(parsed?.comments?.map((c) => c.text)).toEqual(["kept"]);
  });

  it("never reads an indented row as a field of its own", () => {
    const parsed = parseNote(
      [
        "---",
        "id: n1",
        "created: 1",
        "updated: 2",
        "comments:",
        "  - lines: 1",
        '    text: "kept"',
        "---",
        "",
        "one",
        "",
      ].join("\n"),
    );
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed!)).not.toContain("- lines");
  });
});
