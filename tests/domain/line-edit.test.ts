import { describe, expect, it } from "vitest";

import {
  cutLine,
  firstChangedLine,
  orderPoints,
  pointsEqual,
  replaceRange,
  type SourcePoint,
} from "../../src/domain/line-edit.ts";

const P = (line: number, col: number): SourcePoint => ({ line, col });

describe("orderPoints", () => {
  it("keeps an already-ordered pair", () => {
    expect(orderPoints(P(0, 1), P(2, 0))).toEqual([P(0, 1), P(2, 0)]);
  });
  it("swaps a reversed pair by line", () => {
    expect(orderPoints(P(2, 0), P(0, 1))).toEqual([P(0, 1), P(2, 0)]);
  });
  it("swaps a reversed pair on the same line by column", () => {
    expect(orderPoints(P(1, 5), P(1, 2))).toEqual([P(1, 2), P(1, 5)]);
  });
  it("treats an equal pair as ordered", () => {
    expect(orderPoints(P(1, 2), P(1, 2))).toEqual([P(1, 2), P(1, 2)]);
  });
});

describe("pointsEqual", () => {
  it("is true for identical points", () => {
    expect(pointsEqual(P(1, 2), P(1, 2))).toBe(true);
  });
  it("is false when line or column differ", () => {
    expect(pointsEqual(P(1, 2), P(1, 3))).toBe(false);
    expect(pointsEqual(P(1, 2), P(2, 2))).toBe(false);
  });
});

describe("replaceRange", () => {
  it("splits a line on an inserted newline (Enter)", () => {
    const r = replaceRange(["hello"], P(0, 2), P(0, 2), "\n");
    expect(r.lines).toEqual(["he", "llo"]);
    expect(r.caret).toEqual(P(1, 0));
  });

  it("merges into the previous line (boundary Backspace)", () => {
    const r = replaceRange(["a", "b"], P(0, 1), P(1, 0), "");
    expect(r.lines).toEqual(["ab"]);
    // The caret lands where the two lines joined.
    expect(r.caret).toEqual(P(0, 1));
  });

  it("merges the next line up (boundary Delete)", () => {
    const r = replaceRange(["a", "b"], P(0, 1), P(1, 0), "");
    expect(r.lines).toEqual(["ab"]);
    expect(r.caret).toEqual(P(0, 1));
  });

  it("inserts plain text on a single line", () => {
    const r = replaceRange(["abc"], P(0, 1), P(0, 1), "XY");
    expect(r.lines).toEqual(["aXYbc"]);
    expect(r.caret).toEqual(P(0, 3));
  });

  it("replaces a single-line selection", () => {
    const r = replaceRange(["abcdef"], P(0, 1), P(0, 4), "Z");
    expect(r.lines).toEqual(["aZef"]);
    expect(r.caret).toEqual(P(0, 2));
  });

  it("deletes a multi-line selection, joining the ends", () => {
    const r = replaceRange(["first", "second", "third"], P(0, 2), P(2, 3), "");
    expect(r.lines).toEqual(["fird"]);
    expect(r.caret).toEqual(P(0, 2));
  });

  it("pastes multi-line text across a selection", () => {
    const r = replaceRange(["hello world"], P(0, 6), P(0, 11), "there\nfriend");
    expect(r.lines).toEqual(["hello there", "friend"]);
    expect(r.caret).toEqual(P(1, 6));
  });

  it("orders reversed endpoints before applying", () => {
    const r = replaceRange(["abcdef"], P(0, 4), P(0, 1), "Z");
    expect(r.lines).toEqual(["aZef"]);
    expect(r.caret).toEqual(P(0, 2));
  });

  it("clamps out-of-range columns instead of throwing", () => {
    const r = replaceRange(["ab"], P(0, 99), P(0, 99), "!");
    expect(r.lines).toEqual(["ab!"]);
    expect(r.caret).toEqual(P(0, 3));
  });

  it("keeps surrounding lines untouched", () => {
    const r = replaceRange(["one", "two", "three"], P(1, 1), P(1, 2), "X");
    expect(r.lines).toEqual(["one", "tXo", "three"]);
    expect(r.caret).toEqual(P(1, 2));
  });

  it("inserts a blank line between two lines", () => {
    const r = replaceRange(["one", "two"], P(0, 3), P(0, 3), "\n");
    expect(r.lines).toEqual(["one", "", "two"]);
    expect(r.caret).toEqual(P(1, 0));
  });
});

describe("firstChangedLine", () => {
  it("returns null when the sources are identical", () => {
    expect(firstChangedLine("a\nb\nc", "a\nb\nc")).toBeNull();
  });

  it("finds the first line that differs", () => {
    expect(firstChangedLine("one\ntwo\nthree", "one\nTWO\nthree")).toBe(1);
  });

  it("reports line 0 when the very first line changed", () => {
    expect(firstChangedLine("hello", "world")).toBe(0);
  });

  it("points at the first appended line (shared prefix)", () => {
    // "after" is longer; the shared prefix is the whole "before", so the change
    // begins at the first line past it.
    expect(firstChangedLine("one\ntwo", "one\ntwo\nthree")).toBe(2);
  });

  it("points past the shared prefix when lines were removed", () => {
    // "after" is a strict prefix of "before" (a trailing delete); the index
    // equals the shorter version's line count, which callers clamp.
    expect(firstChangedLine("one\ntwo\nthree", "one\ntwo")).toBe(2);
  });

  it("handles a change deep in a long body", () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 30", "line 30 edited");
    expect(firstChangedLine(before, after)).toBe(30);
  });
});

describe("cutLine", () => {
  it("cuts only the text after a mid-line caret", () => {
    const r = cutLine(["one two three"], P(0, 4))!;
    expect(r.lines).toEqual(["one "]);
    expect(r.text).toBe("two three");
    // The caret stays where it was, ready to type the rest again.
    expect(r.caret).toEqual(P(0, 4));
  });

  it("cuts the whole line from its start, newline and all", () => {
    const r = cutLine(["one", "two", "three"], P(1, 0))!;
    expect(r.lines).toEqual(["one", "three"]);
    // The trailing newline is what makes a paste re-create a line.
    expect(r.text).toBe("two\n");
    // The line that moved up into the gap takes the caret.
    expect(r.caret).toEqual(P(1, 0));
  });

  it("cuts the whole line from its end, where trimming would be a no-op", () => {
    const r = cutLine(["one", "two", "three"], P(1, 3))!;
    expect(r.lines).toEqual(["one", "three"]);
    expect(r.text).toBe("two\n");
    expect(r.caret).toEqual(P(1, 0));
  });

  it("cuts an empty line", () => {
    const r = cutLine(["one", "", "three"], P(1, 0))!;
    expect(r.lines).toEqual(["one", "three"]);
  });

  it("lands the caret at the end of the new last line when the tail goes", () => {
    const r = cutLine(["one", "two"], P(1, 0))!;
    expect(r.lines).toEqual(["one"]);
    expect(r.caret).toEqual(P(0, 3));
  });

  it("empties a one-line note rather than leaving no lines at all", () => {
    const r = cutLine(["only"], P(0, 0))!;
    expect(r.lines).toEqual([""]);
    expect(r.text).toBe("only\n");
    expect(r.caret).toEqual(P(0, 0));
  });

  it("returns null when there is nothing left to cut", () => {
    expect(cutLine([""], P(0, 0))).toBeNull();
  });

  it("cuts exactly what a selection covers, not the lines it touches", () => {
    const r = cutLine(["one", "two", "three", "four"], P(1, 2), P(2, 1))!;
    expect(r.lines).toEqual(["one", "twhree", "four"]);
    expect(r.text).toBe("o\nt");
    expect(r.caret).toEqual(P(1, 2));
  });

  it("cuts a selection inside one line", () => {
    const r = cutLine(["one two three"], P(0, 4), P(0, 7))!;
    expect(r.lines).toEqual(["one  three"]);
    expect(r.text).toBe("two");
  });

  it("joins the lines a whole-line selection spanned", () => {
    const r = cutLine(["one", "two", "three"], P(0, 0), P(1, 3))!;
    expect(r.lines).toEqual(["", "three"]);
    expect(r.text).toBe("one\ntwo");
  });

  it("takes a backwards selection the same way", () => {
    const r = cutLine(["one", "two", "three"], P(2, 1), P(1, 1))!;
    expect(r.lines).toEqual(["one", "three"]);
    expect(r.text).toBe("wo\nt");
  });

  it("clamps a caret past the end of the line", () => {
    const r = cutLine(["one", "two"], P(0, 99))!;
    expect(r.lines).toEqual(["two"]);
    expect(r.text).toBe("one\n");
  });
});
