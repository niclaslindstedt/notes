// Find-in-note: the verbatim, case-insensitive scan behind the editor's find
// bar. Pure — no DOM, no I/O — so the bar, the live-preview highlighter, and
// the plain-textarea fallback all speak the same coordinates.
//
// Deliberately *not* the cross-note `domain/search.ts` engine: that one is
// fuzzy, understands wildcards and regexes, and answers "which notes mention
// this". This one answers "where in the note I'm looking at does this exact
// text appear", which is a different question — a fuzzy hit has no span to
// highlight, and a note-taker scanning their own text expects the literal
// characters they typed, spaces and punctuation included.

/** One hit, in the same `(line, column)` source coordinates the editor uses. */
export type NoteMatch = {
  /** 0-based source line the hit sits on. */
  line: number;
  /** Column of the hit's first character within that line. */
  from: number;
  /** Column just past its last character. */
  to: number;
};

/** Escape every character that means something to a regular expression. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every occurrence of `query` in `body`, verbatim and case-insensitive, in
 * document order. Occurrences never overlap — the scan resumes past each hit —
 * and an empty query finds nothing.
 *
 * The comparison runs through a case-insensitive `RegExp` rather than
 * lowercasing both sides, because a few characters change *length* when
 * lowercased (`İ` becomes two code units), which would slide every subsequent
 * column out of step with the source the editor highlights.
 */
export function findMatches(body: string, query: string): NoteMatch[] {
  if (query === "") return [];
  const re = new RegExp(escapeRegExp(query), "gi");
  const matches: NoteMatch[] = [];
  const lines = body.split("\n");
  for (const [line, text] of lines.entries()) {
    re.lastIndex = 0;
    let hit = re.exec(text);
    while (hit !== null) {
      matches.push({ line, from: hit.index, to: hit.index + hit[0].length });
      // A zero-length match can't happen (the query is non-empty), but a
      // runaway lastIndex would spin forever if it ever did.
      if (re.lastIndex === hit.index) re.lastIndex += 1;
      hit = re.exec(text);
    }
  }
  return matches;
}
