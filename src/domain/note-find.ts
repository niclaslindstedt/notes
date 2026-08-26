// Find-in-note: the scan behind the editor's find bar. Pure — no DOM, no I/O —
// so the bar, the live-preview highlighter, the plain-textarea fallback, and
// the replace side (`note-replace.ts`) all speak the same coordinates.
//
// Deliberately *not* the cross-note `domain/search.ts` engine: that one is
// fuzzy and answers "which notes mention this". This one answers "where in the
// note I'm looking at does this text appear", which is a different question —
// a fuzzy hit has no span to highlight, and a note-taker scanning their own
// text expects the literal characters they typed, spaces and punctuation
// included.
//
// The one exception the literal rule allows is **regex mode**, which the find
// bar's `.*` toggle turns on: the query is then handed to `RegExp` as typed,
// so a pattern can match what a literal string can't and its capture groups
// feed a replacement's `$1`. It is still case-insensitive either way (the bar
// is one search field, not a settings panel).
//
// The scan runs over the **whole body** rather than line by line, with the `m`
// flag — the same reading a code editor's find widget gives a pattern. So `^`
// and `$` still anchor to a *line* (which is what a note-taker means by them),
// `.` still never swallows a line break, but `\n` matches one, and a match may
// therefore span lines. That is the whole point: `\n\n` finds a blank line, and
// a `\n` in the replacement writes one (`note-replace.ts`). A hit consequently
// carries an **end line** as well as a start line, and every surface that
// paints one has to honour it — `matchLineSpans` below is the shared way to cut
// a hit into the per-line pieces a renderer can draw.

/** How a query is read. */
export type FindOptions = {
  /**
   * Read the query as a JavaScript regular expression rather than as literal
   * text. Off by default — the bar's `.*` toggle turns it on.
   */
  regex?: boolean;
};

/**
 * One hit, in the same `(line, column)` source coordinates the editor uses.
 * `endLine` equals `line` for the ordinary hit that sits on one line; a regex
 * hit that matched across a line break ends further down, and `to` is then a
 * column on *that* line.
 */
export type NoteMatch = {
  /** 0-based source line the hit starts on. */
  line: number;
  /** Column of the hit's first character within that line. */
  from: number;
  /** 0-based source line the hit ends on — `line` unless it spans a break. */
  endLine: number;
  /** Column just past its last character, within `endLine`. */
  to: number;
};

/**
 * A hit plus the raw match behind it, which is what a replacement template's
 * `$&`, `$1`…`$99` and `$<name>` read. Only the replace side needs this; the
 * highlighter takes the narrower `NoteMatch`.
 *
 * The whole `RegExpExecArray` is carried rather than a tidied-up list of
 * capture strings, because `expandReplacement` (`domain/transform.ts`) already
 * speaks exactly that shape — one `$`-template grammar, one implementation of
 * it, shared with the Transform rules.
 */
export type NoteHit = NoteMatch & {
  match: RegExpExecArray;
  /** Offset of the hit's first character within the whole body. */
  start: number;
  /** Offset just past its last character within the whole body. */
  end: number;
};

/** Escape every character that means something to a regular expression. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The query as a `RegExp`, or `null` when regex mode is on and the pattern
 * doesn't compile — a half-typed `(foo` is a state the bar spends most of its
 * keystrokes in, so it is reported rather than thrown.
 *
 * The comparison runs through a case-insensitive `RegExp` over the original
 * text rather than lowercasing both sides, because a few characters change
 * *length* when lowercased (`İ` becomes two code units), which would slide
 * every subsequent column out of step with the source the editor highlights.
 *
 * `m` is on because the scan runs over the whole body: without it `^` and `$`
 * would mean the start and end of the *note*, and a note-taker searching
 * `^#` means the start of a line.
 */
export function compilePattern(
  query: string,
  { regex = false }: FindOptions = {},
): RegExp | null {
  if (query === "") return null;
  try {
    return new RegExp(regex ? query : escapeRegExp(query), "gim");
  } catch {
    return null;
  }
}

/**
 * Whether `query` is something the scan can run. An empty query is "valid" —
 * it simply finds nothing — so the bar only paints its error state for a
 * pattern that was actually typed and actually doesn't compile.
 */
export function isPatternValid(
  query: string,
  options: FindOptions = {},
): boolean {
  return query === "" || compilePattern(query, options) !== null;
}

/**
 * The offset each source line starts at, so a flat match index can be turned
 * back into the `(line, column)` the editor speaks. Shared with the replace
 * side, which slices the body flat and labels the result by line.
 */
export function lineStarts(body: string): number[] {
  const starts = [0];
  let at = body.indexOf("\n");
  while (at !== -1) {
    starts.push(at + 1);
    at = body.indexOf("\n", at + 1);
  }
  return starts;
}

/**
 * Every occurrence of `query` in `body`, in document order, with its captures.
 * Occurrences never overlap — the scan resumes past each hit — and an empty (or
 * uncompilable) query finds nothing.
 *
 * **Zero-length matches are dropped.** A literal query can't produce one, but a
 * pattern like `x*` matches the empty string at every column; there is no span
 * to highlight, step onto, or replace, so the scan skips past them rather than
 * filling the bar with hits that point at nothing.
 */
export function findHits(
  body: string,
  query: string,
  options: FindOptions = {},
): NoteHit[] {
  const re = compilePattern(query, options);
  if (!re) return [];
  const hits: NoteHit[] = [];
  const starts = lineStarts(body);
  // Hits arrive in ascending order and never overlap, so the line each offset
  // falls on is found by walking a pointer forward rather than searching from
  // the top of the note for every one of them.
  let cursor = 0;
  const lineOf = (offset: number) => {
    while (cursor + 1 < starts.length && starts[cursor + 1]! <= offset)
      cursor += 1;
    return cursor;
  };
  re.lastIndex = 0;
  let hit = re.exec(body);
  while (hit !== null) {
    if (hit[0].length > 0) {
      const start = hit.index;
      const end = start + hit[0].length;
      const line = lineOf(start);
      const from = start - starts[line]!;
      const endLine = lineOf(end);
      hits.push({
        line,
        from,
        endLine,
        to: end - starts[endLine]!,
        match: hit,
        start,
        end,
      });
    } else {
      // A zero-length match leaves `lastIndex` where it is; step it on by
      // hand or the scan spins forever on the same column.
      re.lastIndex += 1;
    }
    hit = re.exec(body);
  }
  return hits;
}

/**
 * The same scan, narrowed to what the highlighter needs. This is what the find
 * bar and both editing surfaces run on every keystroke, so it hands back plain
 * spans rather than the captures only a replacement reads.
 */
export function findMatches(
  body: string,
  query: string,
  options: FindOptions = {},
): NoteMatch[] {
  return findHits(body, query, options).map(({ line, from, endLine, to }) => ({
    line,
    from,
    endLine,
    to,
  }));
}

/** One line's worth of a hit — what a renderer can actually paint. */
export type MatchSpan = { line: number; from: number; to: number };

/**
 * A hit cut into one span per source line it covers: the start line from the
 * hit's column to its end, whole lines in the middle, and the last line up to
 * the hit's end column. A hit that stays on one line is one span, which is the
 * overwhelmingly common case and costs nothing.
 *
 * **Empty spans are dropped**, because there is nothing to draw for one: the
 * `\n` a hit swallows lives *past* the end of a line's text, so a hit that ends
 * at the very start of a line (or begins at the very end of one) contributes
 * no ink there. Matching a bare line break therefore counts and steps like any
 * other hit while highlighting nothing — the alternative is a `<mark>` of zero
 * width, which paints the same nothing with more machinery.
 */
export function matchLineSpans(
  match: NoteMatch,
  lines: readonly string[],
): MatchSpan[] {
  if (match.endLine === match.line)
    return match.to > match.from
      ? [{ line: match.line, from: match.from, to: match.to }]
      : [];
  const spans: MatchSpan[] = [];
  for (let line = match.line; line <= match.endLine; line += 1) {
    const from = line === match.line ? match.from : 0;
    const to = line === match.endLine ? match.to : (lines[line]?.length ?? 0);
    if (to > from) spans.push({ line, from, to });
  }
  return spans;
}
