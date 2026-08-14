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
// feed a replacement's `$1`. Everything else is unchanged — the scan still runs
// **per line**, so `^` and `$` anchor to a line and no match ever spans a line
// break, and it is still case-insensitive either way (the bar is one search
// field, not a settings panel).

/** How a query is read. */
export type FindOptions = {
  /**
   * Read the query as a JavaScript regular expression rather than as literal
   * text. Off by default — the bar's `.*` toggle turns it on.
   */
  regex?: boolean;
};

/** One hit, in the same `(line, column)` source coordinates the editor uses. */
export type NoteMatch = {
  /** 0-based source line the hit sits on. */
  line: number;
  /** Column of the hit's first character within that line. */
  from: number;
  /** Column just past its last character. */
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
export type NoteHit = NoteMatch & { match: RegExpExecArray };

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
 */
export function compilePattern(
  query: string,
  { regex = false }: FindOptions = {},
): RegExp | null {
  if (query === "") return null;
  try {
    return new RegExp(regex ? query : escapeRegExp(query), "gi");
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
  const lines = body.split("\n");
  for (const [line, text] of lines.entries()) {
    re.lastIndex = 0;
    let hit = re.exec(text);
    while (hit !== null) {
      if (hit[0].length > 0) {
        hits.push({
          line,
          from: hit.index,
          to: hit.index + hit[0].length,
          match: hit,
        });
      } else {
        // A zero-length match leaves `lastIndex` where it is; step it on by
        // hand or the scan spins forever on the same column.
        re.lastIndex += 1;
      }
      hit = re.exec(text);
    }
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
  return findHits(body, query, options).map(({ line, from, to }) => ({
    line,
    from,
    to,
  }));
}
