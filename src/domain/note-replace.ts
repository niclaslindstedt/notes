// Replace-in-note: the write half of the editor's find bar, over the same scan
// its highlighter reads (`note-find.ts`). Pure — no DOM, no I/O — so what the
// preview promises and what the buttons apply are computed by the same code
// rather than by two implementations that can drift.
//
// Three operations, and they are deliberately the only three:
//
//   - `replaceOne` rewrites the hit the bar is parked on and says which hit to
//     park on next.
//   - `replaceAll` rewrites every hit in one pass.
//   - `previewReplacements` rewrites nothing and describes what the other two
//     *would* do, line by line, as kept / removed / added runs the bar paints
//     as an inline diff.
//
// A replacement is inserted **verbatim** in literal mode: replacing with `$1`
// writes the characters `$1`, because a literal search is a promise that what
// you typed is what you get on both sides of it. In regex mode — the bar's
// `.*` toggle — the template expands `$&`, `$1`…`$99`, `$<name>` and `$$` the
// way `String.replace` does, since that is the whole reason to reach for a
// pattern. That expansion is **not** reimplemented here: `expandReplacement`
// (`domain/transform.ts`) already speaks the grammar for the Transform rules,
// and one grammar deserves one implementation.
//
// Nothing here re-scans what it just wrote: every operation plans its edits
// against the body it was handed, so replacing `a` with `aa` terminates
// instead of feeding itself.

import { findHits, type FindOptions, type NoteHit } from "./note-find.ts";
import { expandReplacement } from "./transform.ts";

/** One run of a previewed line: text that stays, goes, or arrives. */
export type PreviewSegment = {
  kind: "kept" | "removed" | "added";
  text: string;
};

/** One line the replacement would touch, as an inline diff. */
export type PreviewLine = {
  /** 0-based source line, so the bar can label it the way the gutter does. */
  line: number;
  segments: readonly PreviewSegment[];
};

/** What `replaceOne` did, and where the bar should stand afterwards. */
export type ReplaceOneResult = {
  /** The note's body with that one hit rewritten. */
  body: string;
  /**
   * Index of the hit to park on next — the first one at or after the text just
   * inserted, wrapping to `0`, or `-1` when the rewrite left no hits at all.
   */
  index: number;
};

/**
 * What one hit becomes. Literal mode inserts the template exactly as typed —
 * `$1` is two characters there, not a capture — so the only mode that expands
 * anything is the one where capture groups exist to be expanded.
 */
function insertionFor(
  template: string,
  hit: NoteHit,
  { regex = false }: FindOptions = {},
): string {
  return regex ? expandReplacement(template, hit.match) : template;
}

/** Group hits by the line they sit on, keeping each line's hits in order. */
function byLine(hits: readonly NoteHit[]): Map<number, NoteHit[]> {
  const lines = new Map<number, NoteHit[]>();
  for (const hit of hits) {
    const existing = lines.get(hit.line);
    if (existing) existing.push(hit);
    else lines.set(hit.line, [hit]);
  }
  return lines;
}

/**
 * `body` with every hit rewritten, in one pass. Hits never overlap and each
 * line is rebuilt left to right from the *original* line, so inserted text is
 * never itself matched and the columns stay in step as the line's length
 * changes underneath.
 */
export function replaceAll(
  body: string,
  query: string,
  replacement: string,
  options: FindOptions = {},
): string {
  const hits = findHits(body, query, options);
  if (hits.length === 0) return body;
  const lines = body.split("\n");
  for (const [line, lineHits] of byLine(hits)) {
    const source = lines[line] ?? "";
    let out = "";
    let cursor = 0;
    for (const hit of lineHits) {
      out += source.slice(cursor, hit.from);
      out += insertionFor(replacement, hit, options);
      cursor = hit.to;
    }
    lines[line] = out + source.slice(cursor);
  }
  return lines.join("\n");
}

/**
 * `body` with the hit at `index` rewritten, or `null` when there is no such hit
 * (the query changed, or the note did, under a stale cursor).
 *
 * The returned `index` is found by re-scanning the *rewritten* body and taking
 * the first hit at or after the inserted text. That is what makes pressing
 * Replace repeatedly walk the note rather than stall: a replacement that
 * matches the query again (`a` → `aa`) leaves a hit exactly where the cursor
 * was, and stepping past it is the only reading that terminates.
 */
export function replaceOne(
  body: string,
  query: string,
  replacement: string,
  index: number,
  options: FindOptions = {},
): ReplaceOneResult | null {
  const hit = findHits(body, query, options)[index];
  if (!hit) return null;
  const lines = body.split("\n");
  const source = lines[hit.line] ?? "";
  const insert = insertionFor(replacement, hit, options);
  lines[hit.line] = source.slice(0, hit.from) + insert + source.slice(hit.to);
  const next = lines.join("\n");
  const resumeAt = hit.from + insert.length;
  const remaining = findHits(next, query, options);
  const found = remaining.findIndex(
    (h) => h.line > hit.line || (h.line === hit.line && h.from >= resumeAt),
  );
  return {
    body: next,
    index: found >= 0 ? found : remaining.length > 0 ? 0 : -1,
  };
}

/**
 * What a replace-all *would* write, as one entry per affected line: the text
 * that survives, the text each hit takes away, and the text it puts there. The
 * note is not touched — this is the whole of the preview button.
 *
 * Untouched lines are left out entirely (a long note changed in two places is
 * two rows, not a wall of context), and an empty run is never emitted, so
 * replacing with nothing yields a `removed` with no `added` beside it.
 */
export function previewReplacements(
  body: string,
  query: string,
  replacement: string,
  options: FindOptions = {},
): PreviewLine[] {
  const hits = findHits(body, query, options);
  if (hits.length === 0) return [];
  const lines = body.split("\n");
  const preview: PreviewLine[] = [];
  for (const [line, lineHits] of byLine(hits)) {
    const source = lines[line] ?? "";
    const segments: PreviewSegment[] = [];
    let cursor = 0;
    const push = (kind: PreviewSegment["kind"], text: string) => {
      if (text !== "") segments.push({ kind, text });
    };
    for (const hit of lineHits) {
      push("kept", source.slice(cursor, hit.from));
      push("removed", hit.match[0]);
      push("added", insertionFor(replacement, hit, options));
      cursor = hit.to;
    }
    push("kept", source.slice(cursor));
    preview.push({ line, segments });
  }
  return preview;
}
