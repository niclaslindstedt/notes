import { describe, expect, it } from "vitest";

import {
  addCursorVertically,
  addNextOccurrence,
  applyAtCursors,
  collapsedCursor,
  cursorLines,
  cursorSpan,
  findOccurrence,
  isCollapsed,
  moveCursors,
  normalizeCursors,
  offsetOf,
  pointAt,
  wordAt,
  wordBoundary,
  type Cursor,
} from "../../src/domain/multi-cursor.ts";

const P = (line: number, col: number) => ({ line, col });
const C = (line: number, col: number): Cursor => collapsedCursor(P(line, col));
const R = (line: number, from: number, to: number): Cursor => ({
  anchor: P(line, from),
  head: P(line, to),
});

describe("offsetOf / pointAt", () => {
  const lines = ["ab", "cde", "", "f"];
  it("counts the newline between lines", () => {
    expect(offsetOf(lines, P(0, 0))).toBe(0);
    expect(offsetOf(lines, P(0, 2))).toBe(2);
    expect(offsetOf(lines, P(1, 0))).toBe(3);
    expect(offsetOf(lines, P(3, 1))).toBe(9);
  });
  it("round-trips every offset", () => {
    const flat = lines.join("\n");
    for (let i = 0; i <= flat.length; i += 1)
      expect(offsetOf(lines, pointAt(lines, i))).toBe(i);
  });
  it("clamps a point past the end of its line", () => {
    expect(offsetOf(lines, P(0, 99))).toBe(2);
    expect(pointAt(lines, 999)).toEqual(P(3, 1));
  });
});

describe("wordAt", () => {
  it("takes the word the column sits inside", () => {
    expect(wordAt("const width = 2", 8)).toEqual({ from: 6, to: 11 });
  });
  it("takes the word at either of its edges", () => {
    expect(wordAt("const width", 6)).toEqual({ from: 6, to: 11 });
    expect(wordAt("const width", 11)).toEqual({ from: 6, to: 11 });
  });
  it("answers null in whitespace", () => {
    expect(wordAt("a  b", 2)).toBeNull();
  });
  it("keeps non-ASCII letters in the word", () => {
    expect(wordAt("en räksmörgås", 5)).toEqual({ from: 3, to: 13 });
  });
  it("stops at a separator", () => {
    expect(wordAt("foo.bar", 1)).toEqual({ from: 0, to: 3 });
  });
});

describe("findOccurrence", () => {
  const src = "id width id\nrapid id";
  it("finds the next hit after an offset", () => {
    expect(findOccurrence(src, "id", 2, false)).toEqual({ from: 4, to: 6 });
  });
  it("skips a hit inside a longer word when whole-word", () => {
    expect(findOccurrence(src, "id", 2, true)).toEqual({ from: 9, to: 11 });
  });
  it("wraps back through the top of the note", () => {
    expect(findOccurrence(src, "id", 20, true)).toEqual({ from: 0, to: 2 });
  });
  it("answers null when the note holds no other hit", () => {
    expect(findOccurrence("abc", "zz", 0, false)).toBeNull();
  });
});

describe("addNextOccurrence", () => {
  const lines = ["id width id", "rapid id"];
  it("first takes the word under a bare caret without adding a cursor", () => {
    const step = addNextOccurrence(lines, [C(0, 1)], null);
    expect(step?.added).toBe(false);
    expect(step?.session).toEqual({ text: "id", wholeWord: true });
    expect(step?.cursors).toEqual([R(0, 0, 2)]);
  });
  it("then adds a cursor on the next whole-word hit", () => {
    const first = addNextOccurrence(lines, [C(0, 1)], null)!;
    const second = addNextOccurrence(lines, first.cursors, first.session)!;
    expect(second.added).toBe(true);
    expect(second.cursors).toHaveLength(2);
    expect(second.cursors[1]).toEqual(R(0, 9, 11));
  });
  it("matches anywhere when seeded from a selection the user drew", () => {
    const step = addNextOccurrence(lines, [R(0, 0, 2)], null)!;
    expect(step.session).toEqual({ text: "id", wholeWord: false });
    // "width" holds an `id` a whole-word search would step over.
    expect(step.cursors[1]).toEqual(R(0, 4, 6));
  });
  it("wraps and then stops once every hit is taken", () => {
    const src = ["a", "a"];
    const one = addNextOccurrence(src, [R(0, 0, 1)], null)!;
    expect(one.cursors).toHaveLength(2);
    expect(addNextOccurrence(src, one.cursors, one.session)).toBeNull();
  });
  it("declines a caret parked in whitespace", () => {
    expect(addNextOccurrence(["a  b"], [C(0, 2)], null)).toBeNull();
  });
});

describe("applyAtCursors", () => {
  it("types the same character at every caret", () => {
    const out = applyAtCursors(["ab", "ab"], [C(0, 1), C(1, 1)], (span) => ({
      from: span.from,
      to: span.to,
      text: "X",
    }))!;
    expect(out.lines).toEqual(["aXb", "aXb"]);
    expect(out.cursors).toEqual([C(0, 2), C(1, 2)]);
  });
  it("keeps later carets correct when an earlier edit resizes the text", () => {
    const out = applyAtCursors(["one one one"], [C(0, 3), C(0, 7)], (span) => ({
      from: span.from,
      to: span.to,
      text: "!!!",
    }))!;
    expect(out.lines).toEqual(["one!!! one!!! one"]);
    expect(out.cursors).toEqual([C(0, 6), C(0, 13)]);
  });
  it("moves the carets below an inserted newline down a line", () => {
    const out = applyAtCursors(["ab", "cd"], [C(0, 1), C(1, 1)], (span) => ({
      from: span.from,
      to: span.to,
      text: "\n",
    }))!;
    expect(out.lines).toEqual(["a", "b", "c", "d"]);
    expect(out.cursors).toEqual([C(1, 0), C(3, 0)]);
  });
  it("replaces each cursor's own selection", () => {
    const out = applyAtCursors(
      ["id and id"],
      [R(0, 0, 2), R(0, 7, 9)],
      (span) => ({ from: span.from, to: span.to, text: "key" }),
    )!;
    expect(out.lines).toEqual(["key and key"]);
    expect(out.cursors).toEqual([C(0, 3), C(0, 11)]);
  });
  it("lets a cursor with nothing to do ride along", () => {
    const out = applyAtCursors(["ab", "cd"], [C(0, 0), C(1, 1)], (span) =>
      span.from === 0 ? null : { from: span.from - 1, to: span.to, text: "" },
    )!;
    expect(out.lines).toEqual(["ab", "d"]);
    expect(out.cursors).toEqual([C(0, 0), C(1, 0)]);
  });
  it("answers null when no cursor asked for anything", () => {
    expect(applyAtCursors(["ab"], [C(0, 0)], () => null)).toBeNull();
  });
  it("merges the carets an edit collapses onto one spot", () => {
    const out = applyAtCursors(["ab"], [C(0, 1), C(0, 2)], (span) => ({
      from: Math.max(0, span.from - 1),
      to: span.to,
      text: "",
    }))!;
    expect(out.lines).toEqual([""]);
    expect(out.cursors).toEqual([C(0, 0)]);
  });
});

describe("normalizeCursors", () => {
  const lines = ["abcdef"];
  it("sorts into document order for editing but keeps identity order", () => {
    expect(normalizeCursors(lines, [C(0, 4), C(0, 1)])).toEqual([
      C(0, 4),
      C(0, 1),
    ]);
  });
  it("merges two carets at the same place", () => {
    expect(normalizeCursors(lines, [C(0, 2), C(0, 2)])).toEqual([C(0, 2)]);
  });
  it("merges overlapping selections into their union", () => {
    expect(normalizeCursors(lines, [R(0, 0, 3), R(0, 2, 5)])).toEqual([
      R(0, 0, 5),
    ]);
  });
  it("keeps adjacent but disjoint selections apart", () => {
    expect(normalizeCursors(lines, [R(0, 0, 2), R(0, 2, 4)])).toHaveLength(2);
  });
});

describe("addCursorVertically", () => {
  const lines = ["aaaa", "bb", "cccc"];
  it("adds a caret on the line below at the same column", () => {
    const next = addCursorVertically(lines, [C(0, 3)], 1)!;
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({ head: P(1, 2) });
  });
  it("remembers the column past a short line", () => {
    const down = addCursorVertically(lines, [C(0, 3)], 1)!;
    const twice = addCursorVertically(lines, down, 1)!;
    expect(twice.map((c) => c.head)).toContainEqual(P(2, 3));
  });
  it("answers null at the edge of the note", () => {
    expect(addCursorVertically(lines, [C(0, 0)], -1)).toBeNull();
  });
  it("adds a collapsed caret even from a selection", () => {
    const next = addCursorVertically(lines, [R(0, 0, 4)], 1)!;
    expect(isCollapsed(next[1]!)).toBe(true);
  });
});

describe("moveCursors", () => {
  const lines = ["abcd", "ef"];
  it("walks every caret one character", () => {
    expect(moveCursors(lines, [C(0, 1), C(1, 0)], "right", false)).toEqual([
      C(0, 2),
      C(1, 1),
    ]);
  });
  it("steps across a line boundary", () => {
    expect(moveCursors(lines, [C(0, 4)], "right", false)).toEqual([C(1, 0)]);
  });
  it("collapses a selection onto its near edge going left", () => {
    expect(moveCursors(lines, [R(0, 1, 3)], "left", false)).toEqual([C(0, 1)]);
  });
  it("extends from the head when Shift is held", () => {
    expect(moveCursors(lines, [C(0, 1)], "right", true)).toEqual([
      { anchor: P(0, 1), head: P(0, 2) },
    ]);
  });
  it("keeps a goal column across a short line", () => {
    const down = moveCursors(["abcd", "e", "fghi"], [C(0, 4)], "down", false);
    expect(down[0]!.head).toEqual(P(1, 1));
    const again = moveCursors(["abcd", "e", "fghi"], down, "down", false);
    expect(again[0]!.head).toEqual(P(2, 4));
  });
  it("takes the line's edges for Home and End", () => {
    expect(moveCursors(lines, [C(0, 2)], "lineStart", false)).toEqual([
      C(0, 0),
    ]);
    expect(moveCursors(lines, [C(0, 2)], "lineEnd", false)).toEqual([C(0, 4)]);
  });
});

describe("wordBoundary", () => {
  it("steps over the word to its left", () => {
    expect(wordBoundary("one two", 7, -1)).toBe(4);
  });
  it("steps over the gap then the word to its right", () => {
    expect(wordBoundary("one two", 3, 1)).toBe(7);
  });
  it("stops at the line's edge", () => {
    expect(wordBoundary("one", 0, -1)).toBe(0);
    expect(wordBoundary("one", 3, 1)).toBe(3);
  });
});

describe("cursorLines / cursorSpan", () => {
  it("lists every line a cursor touches", () => {
    expect([
      ...cursorLines([{ anchor: P(0, 1), head: P(2, 0) }, C(4, 0)]),
    ]).toEqual([0, 1, 2, 4]);
  });
  it("orders a backwards selection's span", () => {
    expect(cursorSpan(["abc"], { anchor: P(0, 3), head: P(0, 1) })).toEqual({
      from: 1,
      to: 3,
    });
  });
});
