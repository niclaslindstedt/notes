// Pure text-editing primitives over a note's source, expressed as operations on
// its array of lines. The live-preview editor (`src/ui/MarkdownEditor.tsx`) is a
// single contenteditable surface: the browser owns caret movement and native
// same-line edits, but every edit that *crosses a line boundary* — Enter,
// a boundary Backspace/Delete, a multi-line paste, deleting a multi-line
// selection — is applied here instead, so the source string stays the single
// source of truth and the DOM never has to be read back across formatted lines.
//
// Everything is a string transform with no DOM or React, so it is cheap to unit
// test and lives in `domain/`.

/** A caret / selection endpoint in the raw source: a 0-based line and column. */
export type SourcePoint = { line: number; col: number };

/** The outcome of an edit: the new line array and where the caret should land. */
export type EditResult = {
  lines: string[];
  caret: SourcePoint;
};

/** Order two points so the first is at or before the second in the document. */
export function orderPoints(
  a: SourcePoint,
  b: SourcePoint,
): [SourcePoint, SourcePoint] {
  return a.line < b.line || (a.line === b.line && a.col <= b.col)
    ? [a, b]
    : [b, a];
}

/** Whether two points denote the same position. */
export function pointsEqual(a: SourcePoint, b: SourcePoint): boolean {
  return a.line === b.line && a.col === b.col;
}

/**
 * Replace the source spanning `[a, b]` with `text`, returning the new line
 * array and the caret position that should follow the inserted text. Endpoints
 * are ordered first, so callers may pass them in any order (a selection's
 * anchor/focus). `text` may itself contain newlines (a multi-line paste or a
 * plain "\n" for a line split); the columns are clamped into their lines so an
 * out-of-range point can never throw.
 *
 * This one function backs every structural edit: an Enter split is
 * `replaceRange(caret, caret, "\n")`, a boundary Backspace is
 * `replaceRange(endOfPrevLine, startOfThisLine, "")`, a paste is
 * `replaceRange(selStart, selEnd, pastedText)`.
 */
export function replaceRange(
  lines: string[],
  a: SourcePoint,
  b: SourcePoint,
  text: string,
): EditResult {
  const [start, end] = orderPoints(a, b);
  const startLine = lines[start.line] ?? "";
  const endLine = lines[end.line] ?? "";
  const startCol = clamp(start.col, 0, startLine.length);
  const endCol = clamp(end.col, 0, endLine.length);

  const head = startLine.slice(0, startCol);
  const tail = endLine.slice(endCol);
  const merged = (head + text + tail).split("\n");

  const next = [
    ...lines.slice(0, start.line),
    ...merged,
    ...lines.slice(end.line + 1),
  ];

  // The caret lands at the end of the inserted text: on the last line the split
  // produced, at the column where that fragment ends (before the old tail).
  const inserted = text.split("\n");
  const caret =
    inserted.length === 1
      ? { line: start.line, col: startCol + text.length }
      : {
          line: start.line + inserted.length - 1,
          col: inserted[inserted.length - 1]!.length,
        };

  return { lines: next, caret };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Remove the line the caret sits on — the editor's delete-line button and its
 * Ctrl/Cmd+K shortcut. Returns `null` when there is nothing to remove (an
 * already-empty one-line note), so the caller can leave the source untouched.
 *
 * Three shapes, in the order a writer expects them:
 *
 *   * **Caret in the middle of a line** — only the text *after* it goes; the
 *     line (and the caret's column) stays. This is the kill-to-end-of-line
 *     every terminal binds to Ctrl+K, and it's what makes the button useful
 *     for trimming a sentence rather than only for dropping whole lines.
 *   * **Caret at either end of a line** — the whole line goes, newline and
 *     all, so the ones below move up. At the start there is nothing to trim
 *     but the line itself; at the end trimming would delete nothing, and a
 *     button that sometimes does nothing reads as broken.
 *   * **A ranged selection** — every line it touches goes. An endpoint resting
 *     at column 0 hasn't visually taken that line, so it is left alone.
 *
 * The caret lands at the start of whichever line moved up into the gap, or at
 * the end of the new last line when the note's tail was what went.
 */
export function deleteLine(
  lines: readonly string[],
  a: SourcePoint,
  b: SourcePoint = a,
): EditResult | null {
  const [start, end] = orderPoints(a, b);
  const from = clamp(start.line, 0, lines.length - 1);
  const text = lines[from] ?? "";
  const col = clamp(start.col, 0, text.length);

  if (pointsEqual(start, end) && col > 0 && col < text.length) {
    const next = [...lines];
    next[from] = text.slice(0, col);
    return { lines: next, caret: { line: from, col } };
  }

  // A selection ending at the very start of a line stops short of it.
  const last = clamp(end.line, from, lines.length - 1);
  const to = last > from && end.col === 0 ? last - 1 : last;

  if (from === 0 && to === lines.length - 1)
    return lines.length === 1 && text === ""
      ? null
      : { lines: [""], caret: { line: 0, col: 0 } };

  const next = [...lines.slice(0, from), ...lines.slice(to + 1)];
  const line = Math.min(from, next.length - 1);
  return {
    lines: next,
    caret: { line, col: line === from ? 0 : (next[line] ?? "").length },
  };
}

/**
 * The index of the first line that differs between two versions of a note's
 * source, or `null` when they are identical. Used to anchor the scroll when
 * undo / redo swaps the body out from under the editor: the view jumps to the
 * first line the reverted (or re-applied) edit touched, so you see what changed.
 *
 * The index is relative to the shared prefix, so it can equal the shorter
 * version's line count when one is a strict prefix of the other (the change was
 * an append or a trailing delete); callers clamp it into the line array they
 * are scrolling.
 */
export function firstChangedLine(before: string, after: string): number | null {
  if (before === after) return null;
  const a = before.split("\n");
  const b = after.split("\n");
  const shared = Math.min(a.length, b.length);
  let i = 0;
  while (i < shared && a[i] === b[i]) i++;
  return i;
}
