import { describe, expect, it } from "vitest";

import {
  allLines,
  clampLineSelection,
  inLineSelection,
  isContiguous,
  lineRunRange,
  lineSelectionGroups,
  lineSelectionSize,
  lineSelectionSource,
  lineSpan,
  moveLineSelection,
  overwriteLineSelection,
  paintLineRun,
  removeLineSelection,
  sameLineSelection,
  singleLine,
  type LineSelection,
} from "../../src/domain/line-selection.ts";

const NOTE = ["# Title", "", "one", "two", "three"];

/** A selection of exactly these lines, as a stroke over the whole of them. */
function taken(...lines: number[]): LineSelection {
  return {
    lines,
    anchor: lines[0] ?? 0,
    head: lines[lines.length - 1] ?? 0,
  };
}

describe("lineSpan", () => {
  it("reports the outer bounds of what is taken", () => {
    expect(lineSpan(taken(1, 2, 3))).toEqual({ from: 1, to: 3 });
  });

  it("spans the gaps of a scattered selection", () => {
    expect(lineSpan(taken(1, 4))).toEqual({ from: 1, to: 4 });
  });

  it("counts a one-line selection as one line, not none", () => {
    expect(lineSelectionSize(singleLine(2))).toBe(1);
    expect(lineSelectionSize(taken(1, 3, 4))).toBe(3);
  });
});

describe("isContiguous", () => {
  it("is true for an unbroken run and false once there is a gap", () => {
    expect(isContiguous(taken(1, 2, 3))).toBe(true);
    expect(isContiguous(singleLine(2))).toBe(true);
    expect(isContiguous(taken(1, 3))).toBe(false);
  });
});

describe("inLineSelection", () => {
  it("answers for each line individually, gaps included", () => {
    const sel = taken(1, 3);
    expect([0, 1, 2, 3, 4].map((i) => inLineSelection(sel, i))).toEqual([
      false,
      true,
      false,
      true,
      false,
    ]);
  });

  it("is false with no selection at all", () => {
    expect(inLineSelection(null, 0)).toBe(false);
  });
});

describe("sameLineSelection", () => {
  it("compares the lines taken, not just the stroke that drew them", () => {
    expect(sameLineSelection(taken(1, 2), taken(1, 2))).toBe(true);
    expect(sameLineSelection(taken(1, 2), taken(1, 2, 3))).toBe(false);
    expect(sameLineSelection(taken(1, 2), taken(1, 3))).toBe(false);
    expect(sameLineSelection(null, null)).toBe(true);
    expect(sameLineSelection(null, singleLine(0))).toBe(false);
  });

  it("distinguishes direction, so a drag back over the anchor still repaints", () => {
    const down = paintLineRun([], 1, 3, "add");
    const up = paintLineRun([], 3, 1, "add");
    expect(down?.lines).toEqual([1, 2, 3]);
    expect(up?.lines).toEqual([1, 2, 3]);
    expect(sameLineSelection(down, up)).toBe(false);
  });
});

describe("paintLineRun", () => {
  it("takes a line without giving up the lines already taken", () => {
    expect(paintLineRun([1], 3, 3, "add")?.lines).toEqual([1, 3]);
  });

  it("takes every line a stroke crosses, in either direction", () => {
    expect(paintLineRun([], 3, 1, "add")?.lines).toEqual([1, 2, 3]);
  });

  it("gives back the lines an erasing stroke crosses, and only those", () => {
    expect(paintLineRun([0, 1, 2, 4], 1, 2, "remove")?.lines).toEqual([0, 4]);
  });

  it("is null once a stroke has given everything back", () => {
    expect(paintLineRun([2], 2, 2, "remove")).toBeNull();
  });

  it("replayed against the same base, shrinks rather than leaving a high-water mark", () => {
    const base: number[] = [];
    expect(paintLineRun(base, 1, 3, "add")?.lines).toEqual([1, 2, 3]);
    expect(paintLineRun(base, 1, 2, "add")?.lines).toEqual([1, 2]);
  });

  it("keeps the stroke's ends so the arrows can carry it on", () => {
    expect(paintLineRun([], 3, 1, "add")).toMatchObject({ anchor: 3, head: 1 });
  });
});

describe("lineSelectionGroups", () => {
  it("splits a scattered selection into its unbroken runs", () => {
    expect(lineSelectionGroups(taken(0, 1, 3, 6, 7))).toEqual([
      { from: 0, to: 1 },
      { from: 3, to: 3 },
      { from: 6, to: 7 },
    ]);
  });

  it("gives one group for one run", () => {
    expect(lineSelectionGroups(taken(2, 3))).toEqual([{ from: 2, to: 3 }]);
  });
});

describe("clampLineSelection", () => {
  it("drops the lines a note that has since shrunk no longer has", () => {
    expect(clampLineSelection(taken(2, 3, 9), 5)?.lines).toEqual([2, 3]);
  });

  it("is null when nothing it named survives", () => {
    expect(clampLineSelection(taken(7, 8), 5)).toBeNull();
  });

  it("has nothing to select in an empty line array", () => {
    expect(clampLineSelection(singleLine(0), 0)).toBeNull();
  });
});

describe("lineRunRange", () => {
  it("spans first character to last, staying inside the lines", () => {
    expect(lineRunRange(NOTE, 2, 3)).toEqual({
      start: { line: 2, col: 0 },
      end: { line: 3, col: 3 },
    });
  });

  it("clamps a run that reaches past the end of the note", () => {
    expect(lineRunRange(NOTE, 4, 40)).toEqual({
      start: { line: 4, col: 0 },
      end: { line: 4, col: 5 },
    });
  });
});

describe("lineSelectionSource", () => {
  it("takes whole lines with the newlines between them", () => {
    expect(lineSelectionSource(NOTE, taken(2, 3))).toBe("one\ntwo");
  });

  it("closes the gaps of a scattered selection rather than copying them", () => {
    expect(lineSelectionSource(NOTE, taken(0, 2, 4))).toBe(
      "# Title\none\nthree",
    );
  });

  it("takes the block marker of a heading too — the line is the unit", () => {
    expect(lineSelectionSource(NOTE, singleLine(0))).toBe("# Title");
  });
});

describe("removeLineSelection", () => {
  it("takes the lines out entirely, leaving no blanks behind", () => {
    const r = removeLineSelection(NOTE, taken(2, 3));
    expect(r.lines).toEqual(["# Title", "", "three"]);
    expect(r.caret).toEqual({ line: 2, col: 0 });
  });

  it("takes scattered lines out and closes both gaps", () => {
    const r = removeLineSelection(NOTE, taken(1, 3));
    expect(r.lines).toEqual(["# Title", "one", "three"]);
  });

  it("lands the caret at the end of the new last line when the tail went", () => {
    const r = removeLineSelection(NOTE, taken(3, 4));
    expect(r.lines).toEqual(["# Title", "", "one"]);
    expect(r.caret).toEqual({ line: 2, col: 3 });
  });

  it("leaves one empty line when the whole note is taken", () => {
    const r = removeLineSelection(NOTE, allLines(NOTE.length));
    expect(r.lines).toEqual([""]);
    expect(r.caret).toEqual({ line: 0, col: 0 });
  });
});

describe("overwriteLineSelection", () => {
  it("replaces a run with the typed text", () => {
    const r = overwriteLineSelection(NOTE, taken(2, 3), "X");
    expect(r.lines).toEqual(["# Title", "", "X", "three"]);
    expect(r.caret).toEqual({ line: 2, col: 1 });
  });

  it("lands scattered lines' replacement where the first of them was, keeping what was skipped", () => {
    const r = overwriteLineSelection(NOTE, taken(0, 2), "X");
    expect(r.lines).toEqual(["X", "", "two", "three"]);
  });

  it("carries the caret to the end of a multi-line paste", () => {
    const r = overwriteLineSelection(NOTE, singleLine(2), "a\nbb");
    expect(r.lines).toEqual(["# Title", "", "a", "bb", "two", "three"]);
    expect(r.caret).toEqual({ line: 3, col: 2 });
  });
});

describe("moveLineSelection", () => {
  it("steps a single-line selection down the note", () => {
    expect(moveLineSelection(singleLine(1), 1, false, 5).lines).toEqual([2]);
  });

  it("collapses a multi-line selection off the edge it is travelling towards", () => {
    expect(moveLineSelection(taken(1, 2, 3), 1, false, 5).lines).toEqual([4]);
    expect(moveLineSelection(taken(1, 2, 3), -1, false, 5).lines).toEqual([0]);
  });

  it("walks the head alone while extending", () => {
    expect(moveLineSelection(singleLine(1), 1, true, 5).lines).toEqual([1, 2]);
    // Extending back past the anchor shrinks the run rather than flipping it.
    expect(
      moveLineSelection({ lines: [1, 2, 3], anchor: 1, head: 3 }, -1, true, 5)
        .lines,
    ).toEqual([1, 2]);
  });

  it("leaves lines taken outside the walking run alone", () => {
    expect(
      moveLineSelection({ lines: [0, 2, 3], anchor: 2, head: 3 }, 1, true, 5)
        .lines,
    ).toEqual([0, 2, 3, 4]);
  });

  it("parks at the note's edges rather than wrapping", () => {
    expect(moveLineSelection(singleLine(4), 1, false, 5).lines).toEqual([4]);
    expect(moveLineSelection(singleLine(0), -1, true, 5).lines).toEqual([0]);
  });
});

describe("allLines", () => {
  it("takes the whole note", () => {
    expect(allLines(5).lines).toEqual([0, 1, 2, 3, 4]);
  });

  it("never runs backwards on an empty note", () => {
    expect(allLines(0)).toEqual({ lines: [0], anchor: 0, head: 0 });
  });
});
