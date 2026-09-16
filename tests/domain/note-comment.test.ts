import { describe, expect, it } from "vitest";

import {
  addComment,
  commentedLines,
  commentsOnLine,
  formatCommentLines,
  newComment,
  parseCommentLines,
  parseComments,
  remapComments,
  removeComment,
  updateCommentText,
  type LineComment,
} from "../../src/domain/note-comment.ts";
import { editNote, setNoteComments, type Note } from "../../src/domain/note.ts";

function comment(over: Partial<LineComment> = {}): LineComment {
  return {
    id: "c1",
    lines: [2],
    text: "Needs a source",
    createdAt: 10,
    updatedAt: 10,
    ...over,
  };
}

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

describe("newComment", () => {
  it("normalises the lines it is given", () => {
    const made = newComment([5, 1, 5, 3], "  look here  ", 7);
    expect(made).not.toBeNull();
    expect(made!.lines).toEqual([1, 3, 5]);
    expect(made!.text).toBe("look here");
    expect(made!.createdAt).toBe(7);
    expect(made!.updatedAt).toBe(7);
  });

  it("refuses a comment with nothing to say, or nowhere to say it", () => {
    expect(newComment([1], "   ")).toBeNull();
    expect(newComment([], "something")).toBeNull();
    expect(newComment([-2], "something")).toBeNull();
  });
});

describe("the comment list", () => {
  it("keeps comments in the order their lines run down the note", () => {
    const list = addComment(
      [comment({ id: "low", lines: [9] })],
      comment({ id: "high", lines: [1] }),
    );
    expect(list.map((c) => c.id)).toEqual(["high", "low"]);
  });

  it("answers which comments a line carries", () => {
    const list = [
      comment({ id: "a", lines: [1, 2] }),
      comment({ id: "b", lines: [2] }),
      comment({ id: "c", lines: [7] }),
    ];
    expect(commentsOnLine(list, 2).map((c) => c.id)).toEqual(["a", "b"]);
    expect(commentedLines(list)).toEqual(new Set([1, 2, 7]));
    expect(commentsOnLine(undefined, 0)).toEqual([]);
  });

  it("edits a comment's text and stamps it", () => {
    const list = updateCommentText([comment()], "c1", " rewritten ", 99);
    expect(list[0]!.text).toBe("rewritten");
    expect(list[0]!.updatedAt).toBe(99);
    expect(list[0]!.createdAt).toBe(10);
  });

  it("hands the same list back when the text didn't change", () => {
    const before = [comment()];
    expect(updateCommentText(before, "c1", "Needs a source", 99)).toBe(before);
  });

  it("clearing a comment's text deletes it", () => {
    expect(updateCommentText([comment()], "c1", "   ")).toEqual([]);
    expect(removeComment([comment()], "c1")).toEqual([]);
  });
});

describe("remapComments", () => {
  const body = "one\ntwo\nthree\nfour";

  it("leaves anchors alone when the edit stays within a line", () => {
    const list = [comment({ lines: [2] })];
    expect(remapComments(body, "one\ntwo\nTHREE\nfour", list)).toBe(list);
  });

  it("shifts the lines below an inserted line", () => {
    const next = "one\nNEW\ntwo\nthree\nfour";
    const list = [comment({ lines: [2, 3] })];
    expect(remapComments(body, next, list)![0]!.lines).toEqual([3, 4]);
  });

  it("leaves the lines above an inserted line where they are", () => {
    const next = "one\ntwo\nthree\nNEW\nfour";
    const list = [comment({ lines: [0, 1] })];
    expect(remapComments(body, next, list)![0]!.lines).toEqual([0, 1]);
  });

  it("shifts the lines below a deleted one back up", () => {
    const next = "one\nthree\nfour";
    const list = [comment({ lines: [2, 3] })];
    expect(remapComments(body, next, list)![0]!.lines).toEqual([1, 2]);
  });

  it("drops the anchor on a line the edit deleted", () => {
    const next = "one\ntwo\nfour";
    const list = [comment({ lines: [2, 3] })];
    expect(remapComments(body, next, list)![0]!.lines).toEqual([2]);
  });

  it("drops a comment whose every line is gone", () => {
    const next = "one\nfour";
    const list = [comment({ lines: [1, 2] })];
    expect(remapComments(body, next, list)).toEqual([]);
  });

  it("keeps anchors inside the note when the note shrinks past them", () => {
    const list = [comment({ lines: [3] })];
    const out = remapComments(body, "one", list)!;
    expect(out).toEqual([]);
  });
});

describe("editNote", () => {
  it("re-anchors the note's comments across a body edit", () => {
    const before = note({
      body: "one\ntwo\nthree",
      comments: [comment({ lines: [2] })],
    });
    const after = editNote(before, "one\nNEW\ntwo\nthree", 50);
    expect(after.comments![0]!.lines).toEqual([3]);
    // The input note is never mutated.
    expect(before.comments![0]!.lines).toEqual([2]);
  });

  it("drops the field entirely when the edit erased every comment", () => {
    const before = note({
      body: "one\ntwo",
      comments: [comment({ lines: [1] })],
    });
    const after = editNote(before, "one", 50);
    expect("comments" in after).toBe(false);
  });
});

describe("setNoteComments", () => {
  it("carries the list and bumps updatedAt — a comment is something written", () => {
    const after = setNoteComments(note({ updatedAt: 1 }), [comment()], 77);
    expect(after.comments).toHaveLength(1);
    expect(after.updatedAt).toBe(77);
  });

  it("drops the field rather than storing an empty list", () => {
    const after = setNoteComments(note({ comments: [comment()] }), [], 77);
    expect("comments" in after).toBe(false);
  });

  it("hands the same note back when nothing changed", () => {
    const list = [comment()];
    const before = note({ comments: list });
    expect(setNoteComments(before, list, 77)).toBe(before);
  });
});

describe("the frontmatter's line list", () => {
  it("writes one-based numbers, collapsing runs into ranges", () => {
    expect(formatCommentLines([2])).toBe("3");
    expect(formatCommentLines([2, 4, 5, 6])).toBe("3,5-7");
    expect(formatCommentLines([6, 4, 5])).toBe("5-7");
  });

  it("reads them back to zero-based indices", () => {
    expect(parseCommentLines("3")).toEqual([2]);
    expect(parseCommentLines("3,5-7")).toEqual([2, 4, 5, 6]);
    expect(parseCommentLines(" 5 - 7 ")).toEqual([4, 5, 6]);
  });

  it("steps over junk rather than failing the whole anchor", () => {
    expect(parseCommentLines("x,4,,0,-3")).toEqual([3]);
    expect(parseCommentLines("")).toEqual([]);
  });

  it("round-trips any set of lines", () => {
    const lines = [0, 1, 2, 9, 11, 12];
    expect(parseCommentLines(formatCommentLines(lines))).toEqual(lines);
  });
});

describe("parseComments", () => {
  it("drops entries that aren't usable comments", () => {
    const out = parseComments([
      comment(),
      { id: "", lines: [1], text: "x", createdAt: 1, updatedAt: 1 },
      { id: "b", lines: [], text: "x", createdAt: 1, updatedAt: 1 },
      { id: "c", lines: [1], text: "   ", createdAt: 1, updatedAt: 1 },
      { id: "d", lines: "1", text: "x", createdAt: 1, updatedAt: 1 },
      null,
    ]);
    expect(out.map((c) => c.id)).toEqual(["c1"]);
  });

  it("yields none for a missing or non-array value", () => {
    expect(parseComments(undefined)).toEqual([]);
    expect(parseComments({})).toEqual([]);
  });

  it("rebuilds entries in a fixed key order so the encoding stays stable", () => {
    const [read] = parseComments([
      { updatedAt: 3, createdAt: 2, text: "x", lines: [1], id: "z" },
    ]);
    expect(Object.keys(read!)).toEqual([
      "id",
      "lines",
      "text",
      "createdAt",
      "updatedAt",
    ]);
  });
});
