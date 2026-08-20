// Where a multi-cursor column is drawn on screen.
//
// A browser hands a page exactly one selection, so exactly one of the editor's
// cursors gets a real caret and a real highlight; every other one is painted by
// `MultiCursorOverlay`, and this is what tells it where. It walks the cursors,
// measures each against the line elements the editor has rendered raw for
// precisely this reason (a formatted line's text isn't its source, so a source
// column would land in the wrong place), and returns boxes in the overlay's own
// coordinate space.
//
// Measurement, not policy: it reads the DOM and returns numbers. Everything
// about which cursors exist lives in `domain/multi-cursor.ts`.

import {
  cursorPoints,
  isCollapsed,
  type Cursor,
} from "../domain/multi-cursor.ts";
import {
  caretRectAt,
  columnRects,
  type ColumnRect,
} from "./contenteditable-caret.ts";

/** The boxes one paint of the overlay covers. */
export type CursorPaint = {
  /** A hairline box per painted caret. */
  carets: ColumnRect[];
  /** One box per soft-wrapped row of every painted selection. */
  selections: ColumnRect[];
};

/** Nothing to paint — a stable reference so an idle editor never re-renders. */
export const NO_PAINT: CursorPaint = { carets: [], selections: [] };

/** Whether a paint would draw anything at all. */
export function isEmptyPaint(paint: CursorPaint): boolean {
  return paint.carets.length === 0 && paint.selections.length === 0;
}

/** Whether two paints cover the same boxes, so an unchanged one can be kept. */
export function samePaint(a: CursorPaint, b: CursorPaint): boolean {
  return sameRects(a.carets, b.carets) && sameRects(a.selections, b.selections);
}

function sameRects(a: ColumnRect[], b: ColumnRect[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (r, i) =>
        r.left === b[i]!.left &&
        r.top === b[i]!.top &&
        r.width === b[i]!.width &&
        r.height === b[i]!.height,
    )
  );
}

/**
 * Measure every cursor except `skip` — the one the browser is drawing itself —
 * against the lines rendered under `root`, in coordinates relative to `origin`
 * (the overlay's own box).
 *
 * A cursor whose line isn't in the DOM is silently left out rather than drawn
 * in the wrong place: the overlay is re-measured on the next layout, by which
 * time the line exists.
 */
export function measureCursors(
  root: HTMLElement,
  origin: { left: number; top: number },
  lines: readonly string[],
  cursors: readonly Cursor[],
  skip: number | null,
): CursorPaint {
  const carets: ColumnRect[] = [];
  const selections: ColumnRect[] = [];
  cursors.forEach((cursor, index) => {
    if (index === skip) return;
    const [start, end] = cursorPoints(cursor);
    if (!isCollapsed(cursor)) {
      for (let line = start.line; line <= end.line; line += 1) {
        const el = lineElement(root, line);
        if (!el) continue;
        const from = line === start.line ? start.col : 0;
        const to = line === end.line ? end.col : (lines[line] ?? "").length;
        selections.push(...columnRects(el, from, to));
      }
    }
    const headEl = lineElement(root, cursor.head.line);
    const caret = headEl ? caretRectAt(headEl, cursor.head.col) : null;
    if (caret) carets.push(caret);
  });
  return {
    carets: carets.map((r) => translate(r, origin)),
    selections: selections.map((r) => translate(r, origin)),
  };
}

function lineElement(root: HTMLElement, line: number): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-line-index="${line}"]`);
}

function translate(
  rect: ColumnRect,
  origin: { left: number; top: number },
): ColumnRect {
  return {
    ...rect,
    left: rect.left - origin.left,
    top: rect.top - origin.top,
  };
}
