// The pure half of **select mode**: a selection measured in whole lines rather
// than in characters.
//
// The editor's ordinary selection is a pair of `(line, col)` points the browser
// draws between — precise, and on a touchscreen almost impossible to aim: two
// handles have to be dragged to two exact characters to take five lines. Select
// mode drops the columns entirely. A press takes the line it lands on, a second
// press on the same line gives it back, a stroke down the rail takes every line
// it crosses, and everything that follows — copy, cut, delete, typing over it, a
// block format — operates on whole lines.
//
// What is taken is a **set**, not a range. Picking one line must never give up
// the last one: the lines wanted for a copy are as often scattered down the note
// (three entries out of a list, the two headings and nothing between them) as
// they are one unbroken run, and a model that can only hold a run forces the
// second press to throw the first away. So every function here reads
// `sel.lines`, and the ones that have to produce a *range* — the exit handover,
// a block format — work group by contiguous group instead of assuming one.
//
// Nothing here touches the DOM: a `LineSelection` is a list of line indices, and
// the functions below turn it into the source points, the verbatim text, and the
// edits the editor applies through the same engine every other edit uses
// (`domain/line-edit.ts`).

import type { EditResult, SourcePoint } from "./line-edit.ts";

/**
 * The lines select mode has taken.
 *
 * `lines` is the whole answer: ascending, without duplicates, and never empty —
 * a selection holding nothing is `null`, not a `LineSelection` with an empty
 * list. Read it directly; it is the set, and it need not be one unbroken run.
 *
 * `anchor` and `head` are the two ends of the *stroke that drew last* — the line
 * a press landed on and the line a drag (or a Shift+arrow) has reached from it.
 * They are not the selection and never stand in for it: they exist so that
 * carrying a stroke on grows the run it started rather than starting a third
 * one, and so the arrow keys have somewhere to walk from.
 */
export type LineSelection = {
  lines: readonly number[];
  anchor: number;
  head: number;
};

/**
 * What a stroke does to the lines it crosses. Which one a gesture is, is
 * decided once, by the line it *starts* on: press an untaken line and the
 * stroke takes every line it reaches; press one already taken and the same
 * stroke gives them back. One gesture, both directions — the finger paints or
 * erases depending on where it lands, which is what makes a second press on a
 * line the way to drop it.
 */
export type PaintMode = "add" | "remove";

function ascending(lines: Iterable<number>): number[] {
  return [...new Set(lines)].sort((a, b) => a - b);
}

/** The one-line selection a press gives before anything is dragged. */
export function singleLine(index: number): LineSelection {
  return { lines: [index], anchor: index, head: index };
}

/**
 * The outer bounds of the selection: its first line and its last. Everything
 * between them is *not* necessarily taken — use `lineSelectionGroups` when the
 * gaps matter, and this when only the extent does (where the hidden caret
 * goes, which line to scroll to).
 */
export function lineSpan(sel: LineSelection): { from: number; to: number } {
  return { from: sel.lines[0] ?? 0, to: sel.lines[sel.lines.length - 1] ?? 0 };
}

/** How many lines are taken (never zero — one line is a selection). */
export function lineSelectionSize(sel: LineSelection): number {
  return sel.lines.length;
}

/** Whether the taken lines are one unbroken run, which is what decides
 *  whether leaving the mode can hand them to the browser as a single range. */
export function isContiguous(sel: LineSelection): boolean {
  const { from, to } = lineSpan(sel);
  return to - from + 1 === sel.lines.length;
}

/** Whether `index` is one of the taken lines — what decides how a line is
 *  painted, and whether a press on it takes or gives back. */
export function inLineSelection(
  sel: LineSelection | null,
  index: number,
): boolean {
  return sel ? sel.lines.includes(index) : false;
}

/** Two selections holding the same lines, drawn by the same stroke. */
export function sameLineSelection(
  a: LineSelection | null,
  b: LineSelection | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.anchor === b.anchor &&
    a.head === b.head &&
    a.lines.length === b.lines.length &&
    a.lines.every((n, i) => n === b.lines[i])
  );
}

/**
 * One stroke of the gesture, applied to the lines that were taken **before it
 * began**. The caller keeps that starting set for the whole drag and replays
 * this on every move, so dragging back up the note un-paints the lines the
 * finger has left rather than leaving a high-water mark behind — and lines
 * taken by earlier strokes are never disturbed either way.
 *
 * Returns null when the stroke has given back everything that was taken; there
 * is no such thing as a selection holding no lines.
 */
export function paintLineRun(
  base: readonly number[],
  anchor: number,
  head: number,
  mode: PaintMode,
): LineSelection | null {
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  let lines: number[];
  if (mode === "add") {
    const run: number[] = [];
    for (let n = from; n <= to; n++) run.push(n);
    lines = ascending([...base, ...run]);
  } else {
    lines = base.filter((n) => n < from || n > to);
  }
  return lines.length === 0 ? null : { lines, anchor, head };
}

/**
 * The taken lines split into unbroken runs, in document order. This is what a
 * block format is applied over — five scattered lines are five one-line
 * formats, not one format across everything they happen to straddle.
 */
export function lineSelectionGroups(
  sel: LineSelection,
): { from: number; to: number }[] {
  const groups: { from: number; to: number }[] = [];
  for (const n of sel.lines) {
    const last = groups[groups.length - 1];
    if (last && n === last.to + 1) last.to = n;
    else groups.push({ from: n, to: n });
  }
  return groups;
}

/**
 * Fold a selection into the note as it now stands, dropping the lines it named
 * that the note no longer has (another writer's pull, an undo). Returns null
 * when nothing it named survives — including for an empty line array, which has
 * nothing to select.
 */
export function clampLineSelection(
  sel: LineSelection,
  lineCount: number,
): LineSelection | null {
  if (lineCount <= 0) return null;
  const last = lineCount - 1;
  const lines = sel.lines.filter((n) => n >= 0 && n <= last);
  if (lines.length === 0) return null;
  const clamp = (n: number) => Math.min(Math.max(n, 0), last);
  return { lines, anchor: clamp(sel.anchor), head: clamp(sel.head) };
}

/**
 * The source span an unbroken run of whole lines covers: from the first
 * character of its first line to the last character of its last. This is the
 * range typing over a run replaces and the one a block format is applied to —
 * it stays *inside* the lines, so replacing it leaves the surrounding newlines
 * (and so the note's shape) alone.
 */
export function lineRunRange(
  lines: readonly string[],
  from: number,
  to: number,
): { start: SourcePoint; end: SourcePoint } {
  const last = Math.max(lines.length - 1, 0);
  const first = Math.min(Math.max(from, 0), last);
  const end = Math.min(Math.max(to, first), last);
  return {
    start: { line: first, col: 0 },
    end: { line: end, col: (lines[end] ?? "").length },
  };
}

/** The verbatim source of the taken lines, newlines and all — what a copy or a
 *  cut puts on the clipboard. Lines the selection skipped are skipped here too,
 *  so three lines picked out of a list arrive as three lines. */
export function lineSelectionSource(
  lines: readonly string[],
  sel: LineSelection,
): string {
  return sel.lines
    .filter((n) => n >= 0 && n < lines.length)
    .map((n) => lines[n] ?? "")
    .join("\n");
}

/**
 * Take the selected lines out of the note entirely — newline and all, so the
 * lines below move up rather than a run of blanks being left behind. This is
 * what Backspace / Delete / the cut button do to a line selection, and it is
 * the one place a line selection deliberately reaches *outside* the lines it
 * names to swallow the newline that joined each of them to its neighbour.
 *
 * Taking the whole note leaves one empty line: a note with no lines at all
 * isn't a state the editor has (`"".split("\n")` is `[""]`).
 *
 * The caret lands at the start of whichever line moved up into the first gap,
 * or at the end of the new last line when the note's tail was what went — the
 * same landing `cutLine` picks, so a cut through either route feels identical.
 */
export function removeLineSelection(
  lines: readonly string[],
  sel: LineSelection,
): EditResult {
  const taken = new Set(sel.lines);
  const next = lines.filter((_, i) => !taken.has(i));
  if (next.length === 0) return { lines: [""], caret: { line: 0, col: 0 } };
  const first = Math.min(
    Math.max(lineSpan(sel).from, 0),
    Math.max(lines.length - 1, 0),
  );
  const line = Math.min(first, next.length - 1);
  return {
    lines: next,
    caret: { line, col: line === first ? 0 : (next[line] ?? "").length },
  };
}

/**
 * Type (or paste) over the selection: every taken line goes, and `text` lands
 * where the first of them was. Written as a removal plus an insertion rather
 * than as a range replacement because the taken lines need not be adjacent —
 * the text replaces the *selection*, not the stretch of note it spans, so the
 * lines it skipped are still there afterwards.
 */
export function overwriteLineSelection(
  lines: readonly string[],
  sel: LineSelection,
  text: string,
): EditResult {
  const taken = new Set(sel.lines);
  const at = Math.min(
    Math.max(lineSpan(sel).from, 0),
    Math.max(lines.length - 1, 0),
  );
  const inserted = text.split("\n");
  const next: string[] = [];
  for (const [i, line] of lines.entries()) {
    if (i === at) next.push(...inserted);
    if (!taken.has(i)) next.push(line);
  }
  const line = at + inserted.length - 1;
  return {
    lines: next.length === 0 ? [""] : next,
    caret: { line, col: (inserted[inserted.length - 1] ?? "").length },
  };
}

/**
 * Where an arrow key leaves the selection. `extend` (Shift held) walks the head
 * of the last stroke alone, growing or shrinking that run while every line
 * taken outside it stays exactly as it was; without it the selection collapses
 * to the single line beyond the edge it is travelling towards, which is how you
 * walk a one-line selection down a note.
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
  if (extend) {
    const anchor = clamp(sel.anchor);
    const head = clamp(sel.head + direction);
    // The run the arrows are walking is redrawn rather than added to, so
    // shrinking it actually gives lines back — but it is lifted out of the
    // selection first, which leaves every *other* taken line untouched.
    const from = Math.min(anchor, clamp(sel.head));
    const to = Math.max(anchor, clamp(sel.head));
    const rest = sel.lines.filter((n) => n < from || n > to);
    return paintLineRun(rest, anchor, head, "add") ?? singleLine(head);
  }
  // Collapsing a multi-line selection steps off the edge it is travelling
  // towards, not off the head — pressing Down with three lines taken lands on
  // the line after the last of them, which is where the eye already is.
  const { from, to } = lineSpan(sel);
  const edge = direction === 1 ? to : from;
  return singleLine(clamp(edge + direction));
}

/** The whole note as one selection — select mode's answer to Ctrl/Cmd+A. */
export function allLines(lineCount: number): LineSelection {
  const last = Math.max(lineCount - 1, 0);
  const lines: number[] = [];
  for (let n = 0; n <= last; n++) lines.push(n);
  return { lines, anchor: 0, head: last };
}
