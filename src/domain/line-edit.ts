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

/** A cut: what the edit left behind, plus the source text it took away. */
export type CutResult = EditResult & {
  /** Exactly the source that was removed — what the caller puts on the
   *  clipboard, so the cut can be pasted back somewhere else. */
  text: string;
};

/** The source spanning `[a, b]`, with `\n` between the lines it crosses. */
export function sliceRange(
  lines: readonly string[],
  a: SourcePoint,
  b: SourcePoint,
): string {
  const [start, end] = orderPoints(a, b);
  const from = clamp(start.line, 0, lines.length - 1);
  const to = clamp(end.line, from, lines.length - 1);
  const startLine = lines[from] ?? "";
  const endLine = lines[to] ?? "";
  const startCol = clamp(start.col, 0, startLine.length);
  const endCol = clamp(end.col, 0, endLine.length);
  if (from === to) return startLine.slice(startCol, endCol);
  return [
    startLine.slice(startCol),
    ...lines.slice(from + 1, to),
    endLine.slice(0, endCol),
  ].join("\n");
}

/**
 * Cut at the caret — the editor's cut button and its Ctrl/Cmd+K shortcut.
 * Returns the new lines, where the caret should land, and the source that was
 * taken (for the clipboard), or `null` when there is nothing to cut (an
 * already-empty one-line note, or an empty selection), so the caller can leave
 * the source untouched.
 *
 * Three shapes, in the order a writer expects them:
 *
 *   * **A ranged selection** — exactly what is highlighted goes, to the
 *     column, and the caret lands where it started. What you can see is
 *     selected is what ends up on the clipboard.
 *   * **Caret in the middle of a line** — only the text *after* it goes; the
 *     line (and the caret's column) stays. This is the kill-to-end-of-line
 *     every terminal binds to Ctrl+K, and it's what makes the button useful
 *     for lifting the rest of a sentence rather than only whole lines.
 *   * **Caret at either end of a line** — the whole line goes, newline and
 *     all, so the ones below move up. At the start there is nothing to trim
 *     but the line itself; at the end trimming would cut nothing, and a button
 *     that sometimes does nothing reads as broken.
 *
 * A whole line is cut *with* its newline, so pasting it back re-creates a line
 * rather than splicing it into the one the caret is on.
 *
 * After a whole-line cut the caret lands at the start of whichever line moved
 * up into the gap, or at the end of the new last line when the note's tail was
 * what went.
 */
export function cutLine(
  lines: readonly string[],
  a: SourcePoint,
  b: SourcePoint = a,
): CutResult | null {
  const [start, end] = orderPoints(a, b);
  const from = clamp(start.line, 0, lines.length - 1);
  const text = lines[from] ?? "";
  const col = clamp(start.col, 0, text.length);

  if (!pointsEqual(start, end)) {
    const cut = sliceRange(lines, start, end);
    if (cut === "") return null;
    return { ...replaceRange([...lines], start, end, ""), text: cut };
  }

  if (col > 0 && col < text.length) {
    const next = [...lines];
    next[from] = text.slice(0, col);
    return { lines: next, caret: { line: from, col }, text: text.slice(col) };
  }

  if (lines.length === 1)
    return text === ""
      ? null
      : { lines: [""], caret: { line: 0, col: 0 }, text: `${text}\n` };

  const next = [...lines.slice(0, from), ...lines.slice(from + 1)];
  const line = Math.min(from, next.length - 1);
  return {
    lines: next,
    caret: { line, col: line === from ? 0 : (next[line] ?? "").length },
    text: `${text}\n`,
  };
}

/** A line move: the reordered source, and where the moved lines ended up. */
export type LineMove = {
  lines: string[];
  /** The same lines the caller named, at their new indices — ascending, so the
   *  caller can put the selection back over exactly what it moved. */
  selected: number[];
};

/**
 * Move whole lines one row up (`direction: -1`) or down (`1`), the way a code
 * editor's Alt+↑ / Alt+↓ does: the selected lines travel as a block and the
 * line they displace hops over them to the other side, so the note never grows
 * or shrinks — only its order changes.
 *
 * `selected` is a **set** of line indices, not a range, because that is what
 * select mode holds (see `domain/line-selection.ts`). Each unbroken run in it
 * moves on its own: three scattered lines each swap with their own neighbour
 * rather than dragging everything between them along. Runs are maximal, so the
 * line a run swaps with is never part of another run, and the moves can't
 * collide — which is why they need no reconciliation between them.
 *
 * A run already against the edge it is travelling towards simply stays where it
 * is (its neighbours still move), matching the way a code editor parks the top
 * line rather than wrapping it to the bottom. When *nothing* could move, the
 * result is `null` so the caller leaves the source — and the undo timeline —
 * alone rather than committing an edit that changed nothing.
 */
export function moveLines(
  lines: readonly string[],
  selected: readonly number[],
  direction: -1 | 1,
): LineMove | null {
  const last = lines.length - 1;
  const rows = [...new Set(selected)]
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= last)
    .sort((a, b) => a - b);
  if (rows.length === 0) return null;

  const runs: { from: number; to: number }[] = [];
  for (const n of rows) {
    const tail = runs[runs.length - 1];
    if (tail && n === tail.to + 1) tail.to = n;
    else runs.push({ from: n, to: n });
  }

  const next = [...lines];
  const moved: number[] = [];
  let changed = false;
  // Upwards, the topmost run goes first; downwards, the bottom one does. Either
  // way each swap only ever touches the row just outside the run it moves, so a
  // run processed earlier has already vacated the space the next one needs.
  const order = direction === -1 ? runs : [...runs].reverse();
  for (const run of order) {
    const blocked = direction === -1 ? run.from === 0 : run.to === last;
    if (blocked) {
      for (let n = run.from; n <= run.to; n++) moved.push(n);
      continue;
    }
    changed = true;
    if (direction === -1) {
      const above = next[run.from - 1] ?? "";
      for (let n = run.from; n <= run.to; n++) next[n - 1] = next[n] ?? "";
      next[run.to] = above;
    } else {
      const below = next[run.to + 1] ?? "";
      for (let n = run.to; n >= run.from; n--) next[n + 1] = next[n] ?? "";
      next[run.from] = below;
    }
    for (let n = run.from; n <= run.to; n++) moved.push(n + direction);
  }
  if (!changed) return null;
  return { lines: next, selected: moved.sort((a, b) => a - b) };
}

/**
 * The column at the end of the word `col` sits in — where a **touch** tap
 * lands the caret (see `MarkdownEditor`'s tap handling).
 *
 * A fingertip covers roughly a word, so the exact character the browser picks
 * out from under it is a coin toss; snapping forward to the end of the word
 * gives a position the tap can actually aim at, and the one a Backspace can
 * work back from — which is the only delete key a phone has.
 *
 * A "word" here is any run of non-whitespace, punctuation and Markdown markers
 * included: tapping inside `**bold**` lands past the closing `**` (the end of
 * the word as it is *drawn*), and tapping a `---` rule lands at the end of the
 * rule, ready to be erased. A tap that already sits on whitespace is left where
 * it is — it is the end of the preceding word.
 */
export function wordEndAt(text: string, col: number): number {
  let i = clamp(col, 0, text.length);
  while (i < text.length && !/\s/u.test(text[i]!)) i++;
  return i;
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
