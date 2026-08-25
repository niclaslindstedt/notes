import { describe, expect, it } from "vitest";

import {
  allLines,
  clampLineSelection,
  inLineSelection,
  lineSelectionRange,
  lineSelectionSource,
  lineSpan,
  lineSpanSize,
  moveLineSelection,
  removeLineSelection,
  sameLineSelection,
} from "../../src/domain/line-selection.ts";

const NOTE = ["# Title", "", "one", "two", "three"];

describe("lineSpan", () => {
  it("orders a selection dragged downwards", () => {
    expect(lineSpan({ anchor: 1, head: 3 })).toEqual({ from: 1, to: 3 });
  });

  it("orders one dragged upwards the same way", () => {
    expect(lineSpan({ anchor: 3, head: 1 })).toEqual({ from: 1, to: 3 });
  });

  it("counts a one-line selection as one line, not none", () => {
    expect(lineSpanSize({ anchor: 2, head: 2 })).toBe(1);
    expect(lineSpanSize({ anchor: 4, head: 1 })).toBe(4);
  });
});

describe("inLineSelection", () => {
  it("covers both ends of the run", () => {
    const sel = { anchor: 3, head: 1 };
    expect([0, 1, 2, 3, 4].map((i) => inLineSelection(sel, i))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
  });

  it("is false with no selection at all", () => {
    expect(inLineSelection(null, 0)).toBe(false);
  });
});

describe("sameLineSelection", () => {
  it("distinguishes direction, so a drag back over the anchor still repaints", () => {
    expect(
      sameLineSelection({ anchor: 1, head: 3 }, { anchor: 1, head: 3 }),
    ).toBe(true);
    expect(
      sameLineSelection({ anchor: 1, head: 3 }, { anchor: 3, head: 1 }),
    ).toBe(false);
    expect(sameLineSelection(null, null)).toBe(true);
    expect(sameLineSelection(null, { anchor: 0, head: 0 })).toBe(false);
  });
});

describe("clampLineSelection", () => {
  it("folds a run into a note that has since shrunk", () => {
    expect(clampLineSelection({ anchor: 2, head: 9 }, 5)).toEqual({
      anchor: 2,
      head: 4,
    });
  });

  it("has nothing to select in an empty line array", () => {
    expect(clampLineSelection({ anchor: 0, head: 0 }, 0)).toBeNull();
  });
});

describe("lineSelectionRange", () => {
  it("spans first character to last, staying inside the lines", () => {
    expect(lineSelectionRange(NOTE, { anchor: 2, head: 3 })).toEqual({
      start: { line: 2, col: 0 },
      end: { line: 3, col: 3 },
    });
  });

  it("clamps a run that reaches past the end of the note", () => {
    expect(lineSelectionRange(NOTE, { anchor: 4, head: 40 })).toEqual({
      start: { line: 4, col: 0 },
      end: { line: 4, col: 5 },
    });
  });
});

describe("lineSelectionSource", () => {
  it("takes whole lines with the newlines between them", () => {
    expect(lineSelectionSource(NOTE, { anchor: 3, head: 2 })).toBe("one\ntwo");
  });

  it("takes the block marker of a heading too — the line is the unit", () => {
    expect(lineSelectionSource(NOTE, { anchor: 0, head: 0 })).toBe("# Title");
  });
});

describe("removeLineSelection", () => {
  it("takes the lines out entirely, leaving no blanks behind", () => {
    const r = removeLineSelection(NOTE, { anchor: 2, head: 3 });
    expect(r.lines).toEqual(["# Title", "", "three"]);
    expect(r.caret).toEqual({ line: 2, col: 0 });
  });

  it("lands the caret at the end of the new last line when the tail went", () => {
    const r = removeLineSelection(NOTE, { anchor: 3, head: 4 });
    expect(r.lines).toEqual(["# Title", "", "one"]);
    expect(r.caret).toEqual({ line: 2, col: 3 });
  });

  it("leaves one empty line when the whole note is taken", () => {
    const r = removeLineSelection(NOTE, { anchor: 0, head: 4 });
    expect(r.lines).toEqual([""]);
    expect(r.caret).toEqual({ line: 0, col: 0 });
  });
});

describe("moveLineSelection", () => {
  it("steps a single-line run down the note", () => {
    expect(moveLineSelection({ anchor: 1, head: 1 }, 1, false, 5)).toEqual({
      anchor: 2,
      head: 2,
    });
  });

  it("collapses a multi-line run off the edge it is travelling towards", () => {
    expect(moveLineSelection({ anchor: 1, head: 3 }, 1, false, 5)).toEqual({
      anchor: 4,
      head: 4,
    });
    expect(moveLineSelection({ anchor: 1, head: 3 }, -1, false, 5)).toEqual({
      anchor: 0,
      head: 0,
    });
  });

  it("walks the head alone while extending", () => {
    expect(moveLineSelection({ anchor: 1, head: 1 }, 1, true, 5)).toEqual({
      anchor: 1,
      head: 2,
    });
    // Extending back past the anchor shrinks the run rather than flipping it.
    expect(moveLineSelection({ anchor: 1, head: 3 }, -1, true, 5)).toEqual({
      anchor: 1,
      head: 2,
    });
  });

  it("parks at the note's edges rather than wrapping", () => {
    expect(moveLineSelection({ anchor: 4, head: 4 }, 1, false, 5)).toEqual({
      anchor: 4,
      head: 4,
    });
    expect(moveLineSelection({ anchor: 0, head: 0 }, -1, true, 5)).toEqual({
      anchor: 0,
      head: 0,
    });
  });
});

describe("allLines", () => {
  it("takes the whole note", () => {
    expect(allLines(5)).toEqual({ anchor: 0, head: 4 });
  });

  it("never runs backwards on an empty note", () => {
    expect(allLines(0)).toEqual({ anchor: 0, head: 0 });
  });
});
