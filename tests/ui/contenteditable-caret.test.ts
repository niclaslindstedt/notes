// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { visualRowAt } from "../../src/ui/contenteditable-caret.ts";

// jsdom lays nothing out, so wrapping is simulated: every range measured over
// the line reports the row its first character falls in, at `PER_ROW`
// characters per row. That is exactly the shape `visualRowAt` reads — one rect
// per character, its `top` stepping down a row at a time — so the binary search
// over it is the real one.
const PER_ROW = 10;
const ROW_HEIGHT = 20;

const realGetClientRects = Range.prototype.getClientRects;

/** Wrap `text` in a line element that reports `PER_ROW` characters per row. */
function wrappedLine(text: string): HTMLElement {
  const el = document.createElement("div");
  el.textContent = text;
  document.body.append(el);
  Range.prototype.getClientRects = function (this: Range) {
    const column = columnOf(this.startContainer, this.startOffset);
    const top = Math.floor(column / PER_ROW) * ROW_HEIGHT;
    return [{ top, height: ROW_HEIGHT }] as unknown as DOMRectList;
  };
  return el;
}

/** The column a (node, offset) sits at, counting across the line's text nodes. */
function columnOf(node: Node, offset: number): number {
  // Climb to the line element itself — a raw line's text sits inside spans, so
  // the node's own parent is not where the columns are counted from.
  let line = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node)!;
  while (line.parentElement && line.parentElement !== document.body)
    line = line.parentElement;
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let column = 0;
  let text = walker.nextNode() as Text | null;
  while (text) {
    if (text === node) return column + offset;
    column += text.data.length;
    text = walker.nextNode() as Text | null;
  }
  return column + offset;
}

afterEach(() => {
  Range.prototype.getClientRects = realGetClientRects;
  document.body.replaceChildren();
});

describe("visualRowAt", () => {
  it("finds the row a column sits in, as source columns", () => {
    const el = wrappedLine("a".repeat(35)); // four rows: 0-9, 10-19, 20-29, 30-34
    expect(visualRowAt(el, 0)).toEqual({ start: 0, end: 10 });
    expect(visualRowAt(el, 4)).toEqual({ start: 0, end: 10 });
    expect(visualRowAt(el, 14)).toEqual({ start: 10, end: 20 });
    expect(visualRowAt(el, 29)).toEqual({ start: 20, end: 30 });
  });

  it("reads the caret past the last character as the last row", () => {
    // Where a caret sitting at the end of the line lands, and what a move
    // *upwards* into this line asks for.
    const el = wrappedLine("a".repeat(35));
    expect(visualRowAt(el, 35)).toEqual({ start: 30, end: 35 });
  });

  it("clamps a column past the end of the text", () => {
    const el = wrappedLine("a".repeat(35));
    expect(visualRowAt(el, 999)).toEqual({ start: 30, end: 35 });
  });

  it("treats a line that fits on one row as one row", () => {
    const el = wrappedLine("short");
    expect(visualRowAt(el, 3)).toEqual({ start: 0, end: 5 });
  });

  it("answers the whole line when the engine reports no geometry", () => {
    // Un-stubbed jsdom: every rect is zero-height. Callers get the un-wrapped
    // answer rather than a wrong row.
    const el = document.createElement("div");
    el.textContent = "a".repeat(35);
    document.body.append(el);
    expect(visualRowAt(el, 14)).toEqual({ start: 0, end: 35 });
  });

  it("answers an empty line without measuring anything", () => {
    const el = wrappedLine("");
    expect(visualRowAt(el, 0)).toEqual({ start: 0, end: 0 });
  });

  it("counts across the styled spans a raw line is drawn as", () => {
    // The active line is a run of spans over its source, not one text node, so
    // a row's columns have to be counted across them (see `RawLine`).
    const el = wrappedLine("");
    for (const chunk of ["aaaaaaa", "bbbbbbbbbbbbbb", "cccccccccccccc"]) {
      const span = document.createElement("span");
      span.textContent = chunk;
      el.append(span);
    }
    expect(visualRowAt(el, 14)).toEqual({ start: 10, end: 20 });
    expect(visualRowAt(el, 35)).toEqual({ start: 30, end: 35 });
  });
});
