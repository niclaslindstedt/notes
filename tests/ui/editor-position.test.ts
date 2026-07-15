import { afterEach, describe, expect, it } from "vitest";

import {
  getEditorPosition,
  offsetToPoint,
  pointToOffset,
  resetEditorPositions,
  setEditorPosition,
} from "../../src/ui/editor-position.ts";

afterEach(() => resetEditorPositions());

describe("editor-position store", () => {
  it("remembers a note's caret and scroll, keyed by id", () => {
    expect(getEditorPosition("a")).toBeNull();
    setEditorPosition("a", { caret: { line: 3, col: 5 }, scrollTop: 120 });
    setEditorPosition("b", { caret: null, scrollTop: 0 });
    expect(getEditorPosition("a")).toEqual({
      caret: { line: 3, col: 5 },
      scrollTop: 120,
    });
    // A different note keeps its own spot; an unknown id resolves to nothing.
    expect(getEditorPosition("b")).toEqual({ caret: null, scrollTop: 0 });
    expect(getEditorPosition("c")).toBeNull();
  });

  it("clears every remembered position on reset", () => {
    setEditorPosition("a", { caret: { line: 1, col: 1 }, scrollTop: 10 });
    resetEditorPositions();
    expect(getEditorPosition("a")).toBeNull();
  });
});

describe("offsetToPoint / pointToOffset", () => {
  const text = "one\ntwo\n\nfour";

  it("maps a flat offset to a source (line, col)", () => {
    expect(offsetToPoint(text, 0)).toEqual({ line: 0, col: 0 });
    expect(offsetToPoint(text, 2)).toEqual({ line: 0, col: 2 });
    // Just after the first newline: start of line 1.
    expect(offsetToPoint(text, 4)).toEqual({ line: 1, col: 0 });
    expect(offsetToPoint(text, 6)).toEqual({ line: 1, col: 2 });
    // The empty line 2 (between the two newlines).
    expect(offsetToPoint(text, 8)).toEqual({ line: 2, col: 0 });
    // Into the last line.
    expect(offsetToPoint(text, 11)).toEqual({ line: 3, col: 2 });
  });

  it("clamps an out-of-range offset to the document bounds", () => {
    expect(offsetToPoint(text, -5)).toEqual({ line: 0, col: 0 });
    expect(offsetToPoint(text, 999)).toEqual({ line: 3, col: 4 });
  });

  it("round-trips every offset through a point and back", () => {
    for (let offset = 0; offset <= text.length; offset++) {
      const point = offsetToPoint(text, offset);
      expect(pointToOffset(text, point)).toBe(offset);
    }
  });

  it("clamps a point that overshoots its line or the document", () => {
    // Column past the line end lands at the line end.
    expect(pointToOffset(text, { line: 0, col: 99 })).toBe(3);
    // Line past the last line lands on the last line.
    expect(pointToOffset(text, { line: 99, col: 0 })).toBe(9);
  });
});
