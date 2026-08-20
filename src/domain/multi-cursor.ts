// Multiple carets over one note's source — the VS Code editing model, ported
// onto this app's line/column coordinates.
//
// A browser gives a page exactly one selection, so the *browser's* caret can
// only ever be one of these; everything else is state the editor holds and
// draws itself (see `MarkdownEditor.tsx` and `MultiCursorOverlay.tsx`). What
// lives here is the part that has no DOM in it at all: where the cursors are,
// which occurrence the next Ctrl/Cmd+D should take, how an arrow key walks all
// of them at once, and — the one that has to be exactly right — how a single
// keystroke is applied at N places without any of them landing on a column the
// earlier edits already moved.
//
// That last problem is why almost everything below works in **flat offsets**
// into `lines.join("\n")` rather than in `(line, col)` pairs. An insertion on
// line 3 shifts the *line numbers* of every cursor below it as well as the
// columns of the ones beside it; in one flat coordinate it shifts exactly one
// number, monotonically, which makes applying N edits a single left-to-right
// pass with a running offset. Points are converted back at the end.

import { orderPoints, type SourcePoint } from "./line-edit.ts";

/**
 * One caret, or one selection: `anchor` is the end that stays put while the
 * selection is extended, `head` the end that moves and where the caret is
 * drawn. They are equal for a plain caret.
 *
 * `goal` is the column a vertical run is aiming for, remembered per cursor so a
 * column of carets walking Down past a short line returns to its column on the
 * other side (the same behaviour the single caret gets from `goalCol` in the
 * editor, kept here because each cursor needs its own).
 */
export type Cursor = { anchor: SourcePoint; head: SourcePoint; goal?: number };

/** A half-open span of the flat source, as offsets into `lines.join("\n")`. */
export type Span = { from: number; to: number };

/** A replacement to apply at one cursor: swap `[from, to)` for `text`. */
export type Replacement = Span & { text: string };

/** A caret with both ends at the same place. */
export function collapsedCursor(at: SourcePoint): Cursor {
  return { anchor: at, head: at };
}

/** Whether this cursor is a bare caret rather than a selection. */
export function isCollapsed(c: Cursor): boolean {
  return c.anchor.line === c.head.line && c.anchor.col === c.head.col;
}

/** The cursor's endpoints in document order. */
export function cursorPoints(c: Cursor): [SourcePoint, SourcePoint] {
  return orderPoints(c.anchor, c.head);
}

/** The flat offset of a source point, clamped into the document. */
export function offsetOf(lines: readonly string[], p: SourcePoint): number {
  const line = clamp(p.line, 0, Math.max(0, lines.length - 1));
  let at = 0;
  for (let i = 0; i < line; i += 1) at += (lines[i] ?? "").length + 1;
  return at + clamp(p.col, 0, (lines[line] ?? "").length);
}

/** The source point a flat offset lands on, clamped into the document. */
export function pointAt(lines: readonly string[], offset: number): SourcePoint {
  let left = clamp(offset, 0, flatLength(lines));
  for (let i = 0; i < lines.length; i += 1) {
    const len = (lines[i] ?? "").length;
    if (left <= len) return { line: i, col: left };
    left -= len + 1;
  }
  const last = Math.max(0, lines.length - 1);
  return { line: last, col: (lines[last] ?? "").length };
}

/** The cursor's span as flat offsets, ordered. */
export function cursorSpan(lines: readonly string[], c: Cursor): Span {
  const [start, end] = cursorPoints(c);
  return { from: offsetOf(lines, start), to: offsetOf(lines, end) };
}

/** Rebuild a cursor from a flat span, `backward` putting the head at `from`. */
export function cursorFromSpan(
  lines: readonly string[],
  span: Span,
  backward = false,
): Cursor {
  const a = pointAt(lines, span.from);
  const b = pointAt(lines, span.to);
  return backward ? { anchor: b, head: a } : { anchor: a, head: b };
}

/**
 * Sort cursors into document order and merge the ones that touch, so a column
 * of carets can never contain two that would answer the same keystroke twice.
 *
 * The **lowest-indexed** cursor of a merged group wins its identity, which is
 * what keeps the primary (index 0 — the one Escape leaves you on) primary when
 * a later cursor grows into it.
 */
export function normalizeCursors(
  lines: readonly string[],
  cursors: readonly Cursor[],
): Cursor[] {
  const spans = cursors.map((c, index) => ({
    index,
    cursor: c,
    span: cursorSpan(lines, c),
  }));
  const order = [...spans].sort(
    (a, b) => a.span.from - b.span.from || a.span.to - b.span.to,
  );
  const merged: typeof order = [];
  for (const entry of order) {
    const prev = merged[merged.length - 1];
    // Two carets at the same spot are one caret; two selections that overlap
    // are one selection over their union. Adjacent-but-disjoint spans
    // (`ab|cd|`) are left alone — they are two distinct places to type.
    const overlaps =
      prev &&
      (entry.span.from < prev.span.to ||
        (entry.span.from === prev.span.to &&
          prev.span.from === prev.span.to &&
          entry.span.from === entry.span.to));
    if (!prev || !overlaps) {
      merged.push(entry);
      continue;
    }
    const span = {
      from: Math.min(prev.span.from, entry.span.from),
      to: Math.max(prev.span.to, entry.span.to),
    };
    const keep = prev.index <= entry.index ? prev : entry;
    merged[merged.length - 1] = {
      index: keep.index,
      span,
      cursor: cursorFromSpan(
        lines,
        span,
        cursorPoints(keep.cursor)[0] === keep.cursor.head &&
          !isCollapsed(keep.cursor),
      ),
    };
  }
  // Back into identity order, so index 0 is still the primary.
  return merged.sort((a, b) => a.index - b.index).map((e) => e.cursor);
}

/**
 * Apply one edit per cursor in a single pass, and answer where every caret
 * ends up.
 *
 * `plan` is asked, per cursor, what to replace and with what — it receives that
 * cursor's span and the whole flat source, so a Backspace can look at the
 * character behind the caret and a paste can hand a different line to each
 * cursor. Returning null means "this cursor has nothing to do" (a Backspace at
 * the start of the document); it still travels with the other cursors' edits
 * rather than being left pointing at stale text.
 *
 * Edits are applied left to right with a running read head, so a cursor that
 * would edit text an earlier cursor already consumed is clipped rather than
 * corrupting the source. Every caret lands after the text its own edit
 * inserted, which is what makes typing at N places feel like typing at one.
 */
export function applyAtCursors(
  lines: readonly string[],
  cursors: readonly Cursor[],
  plan: (span: Span, source: string, index: number) => Replacement | null,
): { lines: string[]; cursors: Cursor[] } | null {
  if (cursors.length === 0) return null;
  const source = lines.join("\n");
  const reps = cursors.map((c, i) => {
    const span = cursorSpan(lines, c);
    return plan(span, source, i) ?? { from: span.to, to: span.to, text: "" };
  });
  if (reps.every((r) => r.from === r.to && r.text === "")) return null;

  const order = reps
    .map((_, i) => i)
    .sort((a, b) => reps[a]!.from - reps[b]!.from || reps[a]!.to - reps[b]!.to);

  let out = "";
  let read = 0;
  const heads = new Array<number>(cursors.length);
  for (const i of order) {
    const rep = reps[i]!;
    const from = clamp(rep.from, read, source.length);
    const to = clamp(rep.to, from, source.length);
    out += source.slice(read, from) + rep.text;
    read = to;
    heads[i] = out.length;
  }
  out += source.slice(read);

  const next = out.split("\n");
  return {
    lines: next,
    cursors: normalizeCursors(
      next,
      heads.map((offset) => collapsedCursor(pointAt(next, offset))),
    ),
  };
}

// --- Ctrl/Cmd+D: select next occurrence ------------------------------------

/**
 * The characters that end a word, matching VS Code's default
 * `editor.wordSeparators`. A "word" for the purposes of Ctrl/Cmd+D is a run of
 * anything else — letters, digits, underscore, and every non-ASCII letter, so
 * `räksmörgås` is one word.
 */
const WORD_SEPARATORS = new Set("`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?".split(""));

function isWordChar(ch: string): boolean {
  return !WORD_SEPARATORS.has(ch) && !/\s/u.test(ch);
}

/**
 * The word `col` sits in, or null when it sits in whitespace / between
 * separators. Expands both ways from the column, so a caret at either edge of a
 * word — or anywhere inside it — takes the whole word, which is what makes a
 * first Ctrl/Cmd+D land on the thing under the caret rather than on nothing.
 */
export function wordAt(text: string, col: number): Span | null {
  const at = clamp(col, 0, text.length);
  let from = at;
  let to = at;
  while (from > 0 && isWordChar(text[from - 1]!)) from -= 1;
  while (to < text.length && isWordChar(text[to]!)) to += 1;
  return to > from ? { from, to } : null;
}

/**
 * The next occurrence of `needle` at or after `fromOffset`, wrapping back
 * through the top of the note, or null when the note holds none. `wholeWord`
 * refuses a hit whose neighbours are word characters — the difference between
 * Ctrl/Cmd+D on the word `id` skipping over `width` and stopping in it, which
 * is exactly the distinction VS Code draws between a caret-seeded search
 * (whole word) and one seeded from text you selected yourself (anywhere).
 */
export function findOccurrence(
  source: string,
  needle: string,
  fromOffset: number,
  wholeWord: boolean,
): Span | null {
  if (needle === "") return null;
  const at = clamp(fromOffset, 0, source.length);
  const found = scan(source, needle, at, source.length, wholeWord);
  return found ?? scan(source, needle, 0, at + needle.length - 1, wholeWord);
}

function scan(
  source: string,
  needle: string,
  from: number,
  limit: number,
  wholeWord: boolean,
): Span | null {
  let i = source.indexOf(needle, from);
  while (i !== -1 && i <= limit) {
    const to = i + needle.length;
    const clear =
      !wholeWord ||
      ((i === 0 || !isWordChar(source[i - 1]!)) &&
        (to === source.length || !isWordChar(source[to]!)));
    if (clear) return { from: i, to };
    i = source.indexOf(needle, i + 1);
  }
  return null;
}

/** What a Ctrl/Cmd+D run is searching for, held for the length of the run. */
export type OccurrenceSession = {
  /** The text every further press looks for. */
  text: string;
  /** Whether hits must stand as whole words (see `findOccurrence`). */
  wholeWord: boolean;
};

/** The outcome of one Ctrl/Cmd+D press. */
export type OccurrenceStep = {
  cursors: Cursor[];
  session: OccurrenceSession;
  /** True when a *new* cursor was added rather than a word merely selected. */
  added: boolean;
};

/**
 * One press of Ctrl/Cmd+D.
 *
 * With the last cursor collapsed and no run under way, every bare caret takes
 * the word it sits in and the run starts there — the press selects, it does not
 * yet multiply. From then on each press finds the next occurrence of the run's
 * text that no cursor already holds and adds a caret over it, wrapping through
 * the top of the note and stopping (null) once they are all taken.
 */
export function addNextOccurrence(
  lines: readonly string[],
  cursors: readonly Cursor[],
  session: OccurrenceSession | null,
): OccurrenceStep | null {
  if (cursors.length === 0) return null;
  const source = lines.join("\n");
  const last = cursors[cursors.length - 1]!;

  if (!session && isCollapsed(last)) {
    const words = cursors.map((c) => {
      const line = lines[c.head.line] ?? "";
      const word = isCollapsed(c) ? wordAt(line, c.head.col) : null;
      if (!word) return c;
      return {
        anchor: { line: c.head.line, col: word.from },
        head: { line: c.head.line, col: word.to },
      };
    });
    const seed = words[words.length - 1]!;
    if (isCollapsed(seed)) return null;
    const span = cursorSpan(lines, seed);
    return {
      cursors: normalizeCursors(lines, words),
      session: { text: source.slice(span.from, span.to), wholeWord: true },
      added: false,
    };
  }

  const lastSpan = cursorSpan(lines, last);
  const run: OccurrenceSession = session ?? {
    text: source.slice(lastSpan.from, lastSpan.to),
    wholeWord: false,
  };
  if (run.text === "") return null;

  const taken = new Set(
    cursors.map((c) => {
      const s = cursorSpan(lines, c);
      return `${s.from}:${s.to}`;
    }),
  );
  let at = lastSpan.to;
  // Bounded by the number of hits the note can hold, so a note where every
  // occurrence is already taken ends the walk instead of circling forever.
  for (let guard = 0; guard <= taken.size; guard += 1) {
    const hit = findOccurrence(source, run.text, at, run.wholeWord);
    if (!hit) return null;
    if (!taken.has(`${hit.from}:${hit.to}`))
      return {
        cursors: normalizeCursors(lines, [
          ...cursors,
          cursorFromSpan(lines, hit),
        ]),
        session: run,
        added: true,
      };
    at = hit.from + 1;
  }
  return null;
}

// --- Ctrl/Cmd+Up / Down: a column of carets ---------------------------------

/**
 * Add a caret one line above (`-1`) or below (`+1`) each existing one, at the
 * column that cursor is aiming for. Overlapping results merge, so holding the
 * shortcut grows a single column of carets a line at a time; null when the
 * column has already reached the note's edge and there is nothing to add.
 *
 * The new caret is always **collapsed**, whatever the cursor it grew from was
 * holding: this shortcut is for typing the same thing down a column, not for
 * spreading a selection.
 */
export function addCursorVertically(
  lines: readonly string[],
  cursors: readonly Cursor[],
  direction: -1 | 1,
): Cursor[] | null {
  const grown: Cursor[] = [];
  for (const c of cursors) {
    const line = c.head.line + direction;
    if (line < 0 || line >= lines.length) continue;
    const goal = c.goal ?? c.head.col;
    const at = { line, col: Math.min(goal, (lines[line] ?? "").length) };
    grown.push({ anchor: at, head: at, goal });
  }
  if (grown.length === 0) return null;
  const next = normalizeCursors(lines, [...cursors, ...grown]);
  return next.length > cursors.length ? next : null;
}

// --- Arrow keys with a column of carets -------------------------------------

/** The caret moves an arrow key (and its modifiers) can ask for. */
export type CursorMove =
  | "left"
  | "right"
  | "up"
  | "down"
  | "wordLeft"
  | "wordRight"
  | "lineStart"
  | "lineEnd";

/**
 * Walk every cursor one step. `extend` is Shift held: the anchor stays and the
 * head moves, drawing a selection at each caret; without it the cursors
 * collapse — a horizontal move onto the edge of whatever was selected, the way
 * every editor answers Left with a selection standing.
 */
export function moveCursors(
  lines: readonly string[],
  cursors: readonly Cursor[],
  move: CursorMove,
  extend: boolean,
): Cursor[] {
  const vertical = move === "up" || move === "down";
  const moved = cursors.map((c) => {
    if (!extend && !isCollapsed(c) && !vertical) {
      const [start, end] = cursorPoints(c);
      // Left / Home land on the selection's near edge without moving on; Right
      // / End on its far edge.
      const at = move === "left" || move === "lineStart" ? start : end;
      return move === "left" || move === "right"
        ? collapsedCursor(at)
        : collapsedCursor(movePoint(lines, at, move, at.col));
    }
    const from = extend
      ? c.head
      : isCollapsed(c)
        ? c.head
        : cursorPoints(c)[move === "up" ? 0 : 1];
    const goal = vertical ? (c.goal ?? from.col) : undefined;
    const head = movePoint(lines, from, move, goal ?? from.col);
    return {
      anchor: extend ? c.anchor : head,
      head,
      ...(goal === undefined ? {} : { goal }),
    };
  });
  return normalizeCursors(lines, moved);
}

function movePoint(
  lines: readonly string[],
  p: SourcePoint,
  move: CursorMove,
  goal: number,
): SourcePoint {
  const len = (lines[p.line] ?? "").length;
  switch (move) {
    case "left":
      return p.col > 0
        ? { line: p.line, col: p.col - 1 }
        : p.line > 0
          ? { line: p.line - 1, col: (lines[p.line - 1] ?? "").length }
          : p;
    case "right":
      return p.col < len
        ? { line: p.line, col: p.col + 1 }
        : p.line < lines.length - 1
          ? { line: p.line + 1, col: 0 }
          : p;
    case "up":
      return p.line > 0
        ? {
            line: p.line - 1,
            col: Math.min(goal, (lines[p.line - 1] ?? "").length),
          }
        : { line: 0, col: 0 };
    case "down":
      return p.line < lines.length - 1
        ? {
            line: p.line + 1,
            col: Math.min(goal, (lines[p.line + 1] ?? "").length),
          }
        : { line: p.line, col: len };
    case "lineStart":
      return { line: p.line, col: 0 };
    case "lineEnd":
      return { line: p.line, col: len };
    case "wordLeft":
      return {
        line: p.line,
        col: wordBoundary(lines[p.line] ?? "", p.col, -1),
      };
    case "wordRight":
      return { line: p.line, col: wordBoundary(lines[p.line] ?? "", p.col, 1) };
  }
}

/**
 * The column a word-wise step from `col` lands on: over any run of
 * non-word characters first, then over the word itself. Stops at the line's
 * edge — a word jump that runs out of line is the caret parking there, which is
 * what a column of carets on lines of different lengths needs (crossing the
 * boundary would collapse them all onto one line).
 */
export function wordBoundary(
  text: string,
  col: number,
  direction: -1 | 1,
): number {
  let at = clamp(col, 0, text.length);
  const peek = () => (direction < 0 ? text[at - 1] : text[at]);
  const done = () => (direction < 0 ? at <= 0 : at >= text.length);
  while (!done() && !isWordChar(peek()!)) at += direction;
  while (!done() && isWordChar(peek()!)) at += direction;
  return at;
}

/** The set of source lines any cursor touches — the ones drawn as raw source. */
export function cursorLines(cursors: readonly Cursor[]): Set<number> {
  const lines = new Set<number>();
  for (const c of cursors) {
    const [start, end] = cursorPoints(c);
    for (let i = start.line; i <= end.line; i += 1) lines.add(i);
  }
  return lines;
}

function flatLength(lines: readonly string[]): number {
  let total = 0;
  for (const line of lines) total += line.length + 1;
  return Math.max(0, total - 1);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
