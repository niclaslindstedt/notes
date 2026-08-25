// The pure half of **select mode**: a selection measured in whole lines rather
// than in characters.
//
// The editor's ordinary selection is a pair of `(line, col)` points the browser
// draws between — precise, and on a touchscreen almost impossible to aim: two
// handles have to be dragged to two exact characters to take five lines. Select
// mode drops the columns entirely. A press takes the line it lands on, a drag
// walks the far end of the range up or down it, and everything that follows —
// copy, cut, delete, typing over it, a block format — operates on whole lines.
//
// Nothing here touches the DOM: a `LineSelection` is two line indices, and the
// functions below turn it into the source points, the verbatim text, and the
// edits the editor applies through the same engine every other edit uses
// (`domain/line-edit.ts`).

import type { EditResult, SourcePoint } from "./line-edit.ts";

/**
 * A run of whole lines, held the way a text selection is: `anchor` is the line
 * the gesture started on and stays put, `head` is the end that follows the
 * finger (or the arrow key). Either may be the larger — dragging upwards is as
 * ordinary as dragging down — so read the range through `lineSpan`.
 */
export type LineSelection = { anchor: number; head: number };

/** The selection's line range in document order. */
export function lineSpan(sel: LineSelection): { from: number; to: number } {
  return sel.anchor <= sel.head
    ? { from: sel.anchor, to: sel.head }
    : { from: sel.head, to: sel.anchor };
}

/** How many lines the selection covers (never zero — one line is a selection). */
export function lineSpanSize(sel: LineSelection): number {
  const { from, to } = lineSpan(sel);
  return to - from + 1;
}

/** Whether `index` is one of the selected lines — what decides how a line is
 *  painted, and whether a press on it exits select mode. */
export function inLineSelection(
  sel: LineSelection | null,
  index: number,
): boolean {
  if (!sel) return false;
  const { from, to } = lineSpan(sel);
  return index >= from && index <= to;
}

/** Two selections covering the same lines the same way round. */
export function sameLineSelection(
  a: LineSelection | null,
  b: LineSelection | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.anchor === b.anchor && a.head === b.head;
}

/**
 * Fold a selection into the note as it now stands, or drop it when the note no
 * longer has the lines it named (another writer's pull, an undo). Returns null
 * for an empty line array, which has nothing to select.
 */
export function clampLineSelection(
  sel: LineSelection,
  lineCount: number,
): LineSelection | null {
  if (lineCount <= 0) return null;
  const last = lineCount - 1;
  return {
    anchor: Math.min(Math.max(sel.anchor, 0), last),
    head: Math.min(Math.max(sel.head, 0), last),
  };
}

/**
 * The source span the selection covers: from the first character of its first
 * line to the last character of its last. This is the range typing over the
 * selection replaces, and the one a block format is applied to — it stays
 * *inside* the lines, so replacing it leaves the surrounding newlines (and so
 * the note's shape) alone.
 */
export function lineSelectionRange(
  lines: readonly string[],
  sel: LineSelection,
): { start: SourcePoint; end: SourcePoint } {
  const { from, to } = lineSpan(sel);
  const first = Math.min(Math.max(from, 0), Math.max(lines.length - 1, 0));
  const last = Math.min(Math.max(to, first), Math.max(lines.length - 1, 0));
  return {
    start: { line: first, col: 0 },
    end: { line: last, col: (lines[last] ?? "").length },
  };
}

/** The verbatim source of the selected lines, newlines and all — what a copy
 *  or a cut puts on the clipboard. */
export function lineSelectionSource(
  lines: readonly string[],
  sel: LineSelection,
): string {
  const { from, to } = lineSpan(sel);
  const first = Math.min(Math.max(from, 0), Math.max(lines.length - 1, 0));
  const last = Math.min(Math.max(to, first), Math.max(lines.length - 1, 0));
  return lines.slice(first, last + 1).join("\n");
}

/**
 * Take the selected lines out of the note entirely — newline and all, so the
 * lines below move up rather than a run of blanks being left behind. This is
 * what Backspace / Delete / the cut button do to a line selection, and it is
 * the one place a line selection deliberately reaches *outside* its own span
 * (`lineSelectionRange`) to swallow the newline that joined it to its
 * neighbour.
 *
 * Taking the whole note leaves one empty line: a note with no lines at all
 * isn't a state the editor has (`"".split("\n")` is `[""]`).
 *
 * The caret lands at the start of whichever line moved up into the gap, or at
 * the end of the new last line when the note's tail was what went — the same
 * landing `cutLine` picks, so a cut through either route feels identical.
 */
export function removeLineSelection(
  lines: readonly string[],
  sel: LineSelection,
): EditResult {
  const { from, to } = lineSpan(sel);
  const first = Math.min(Math.max(from, 0), Math.max(lines.length - 1, 0));
  const last = Math.min(Math.max(to, first), Math.max(lines.length - 1, 0));
  const next = [...lines.slice(0, first), ...lines.slice(last + 1)];
  if (next.length === 0) return { lines: [""], caret: { line: 0, col: 0 } };
  const line = Math.min(first, next.length - 1);
  return {
    lines: next,
    caret: { line, col: line === first ? 0 : (next[line] ?? "").length },
  };
}

/**
 * Where an arrow key leaves the selection. `extend` (Shift held) walks the head
 * alone, growing or shrinking the run; without it the whole selection steps a
 * line and collapses back to one, which is how you walk a single-line selection
 * down a note.
 *
 * Clamped at both ends of the note rather than wrapping, so holding an arrow
 * parks on the first / last line instead of jumping to the other end.
 */
export function moveLineSelection(
  sel: LineSelection,
  direction: -1 | 1,
  extend: boolean,
  lineCount: number,
): LineSelection {
  const last = Math.max(lineCount - 1, 0);
  const clamp = (n: number) => Math.min(Math.max(n, 0), last);
  if (extend)
    return { anchor: clamp(sel.anchor), head: clamp(sel.head + direction) };
  // Collapsing a multi-line run steps off the edge it is travelling towards,
  // not off the head — pressing Down with three lines taken lands on the line
  // after the last of them, which is where the eye already is.
  const { from, to } = lineSpan(sel);
  const edge = direction === 1 ? to : from;
  const next = clamp(edge + direction);
  return { anchor: next, head: next };
}

/** The whole note as one selection — select mode's answer to Ctrl/Cmd+A. */
export function allLines(lineCount: number): LineSelection {
  return { anchor: 0, head: Math.max(lineCount - 1, 0) };
}
