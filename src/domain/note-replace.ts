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
// writes the characters `$1` and `\n` writes a backslash and an n, because a
// literal search is a promise that what you typed is what you get on both sides
// of it. In regex mode — the bar's `.*` toggle — the template expands `$&`,
// `$1`…`$99`, `$<name>` and `$$` the way `String.replace` does, since that is
// the whole reason to reach for a pattern. That expansion is **not**
// reimplemented here: `expandReplacement` (`domain/transform.ts`) already
// speaks the grammar for the Transform rules, and one grammar deserves one
// implementation.
//
// Regex mode also resolves the **backslash escapes** a single-line field can't
// otherwise carry — `\n`, `\r`, `\t`, `\\` — so a replacement can write a line
// break, which is the only way to write one from a text input. Escapes are
// resolved *before* the `$` grammar runs, so a capture pasted in by `$1` is
// inserted as it stood in the note rather than being re-read for escapes of
// its own.
//
// Everything works in **flat body offsets** rather than per line, because a
// regex hit may span a line break (`note-find.ts`): the note is one string, and
// a replacement crossing a break is an ordinary splice in it.
//
// Nothing here re-scans what it just wrote: every operation plans its edits
// against the body it was handed, so replacing `a` with `aa` terminates
// instead of feeding itself.

import {
  findHits,
  lineStarts,
  type FindOptions,
  type NoteHit,
} from "./note-find.ts";
import { expandReplacement } from "./transform.ts";

/** One run of a previewed line: text that stays, goes, or arrives. */
export type PreviewSegment = {
  kind: "kept" | "removed" | "added";
  text: string;
};

/**
 * One stretch of the note the replacement would touch, as an inline diff.
 * Normally that is a single line; a hit that spans a line break pulls the lines
 * it crosses into one entry, whose `removed` run carries the break itself.
 */
export type PreviewLine = {
  /** 0-based source line, so the bar can label it the way the gutter does. */
  line: number;
  /** Last source line the entry covers — `line` unless a hit spans a break. */
  endLine: number;
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
 * The template's backslash escapes resolved: `\n`, `\r`, `\t` and `\\`. Only
 * regex mode does this — a literal search promises that what you typed is what
 * you get on both sides of it, so there `\n` stays a backslash and an n.
 *
 * It exists because the replace field is a single-line `<input>`: there is no
 * keystroke that puts a line break into it, so an escape is the only way to ask
 * for one. Exported because the editor reads it to tell whether a replacement
 * is about to cross a line break.
 */
export function expandTemplateEscapes(
  template: string,
  { regex = false }: FindOptions = {},
): string {
  if (!regex || !template.includes("\\")) return template;
  return template.replace(/\\([\\nrt])/g, (_, char: string) =>
    char === "n" ? "\n" : char === "r" ? "\r" : char === "t" ? "\t" : "\\",
  );
}

/**
 * What one hit becomes. Literal mode inserts the template exactly as typed —
 * `$1` is two characters there, not a capture — so the only mode that expands
 * anything is the one where capture groups exist to be expanded. `template` has
 * already been through `expandTemplateEscapes`, once for the whole operation
 * rather than once per hit.
 */
function insertionFor(
  template: string,
  hit: NoteHit,
  { regex = false }: FindOptions = {},
): string {
  return regex ? expandReplacement(template, hit.match) : template;
}

/**
 * `body` with every hit rewritten, in one pass. Hits never overlap and the body
 * is rebuilt left to right from the *original* text, so inserted text is never
 * itself matched (`a` → `aa` terminates rather than feeding on its own output)
 * and the offsets stay in step as the note's length changes underneath.
 */
export function replaceAll(
  body: string,
  query: string,
  replacement: string,
  options: FindOptions = {},
): string {
  const hits = findHits(body, query, options);
  if (hits.length === 0) return body;
  const template = expandTemplateEscapes(replacement, options);
  let out = "";
  let cursor = 0;
  for (const hit of hits) {
    out += body.slice(cursor, hit.start);
    out += insertionFor(template, hit, options);
    cursor = hit.end;
  }
  return out + body.slice(cursor);
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
  const insert = insertionFor(
    expandTemplateEscapes(replacement, options),
    hit,
    options,
  );
  const next = body.slice(0, hit.start) + insert + body.slice(hit.end);
  const resumeAt = hit.start + insert.length;
  const remaining = findHits(next, query, options);
  const found = remaining.findIndex((h) => h.start >= resumeAt);
  return {
    body: next,
    index: found >= 0 ? found : remaining.length > 0 ? 0 : -1,
  };
}

/**
 * Hits gathered into the stretches of the note a preview draws as one row: the
 * hits on a line, plus — when one of them spans a line break — the lines it
 * runs into, so the diff is never cut in half at a boundary the hit crosses.
 */
function byStretch(hits: readonly NoteHit[]): NoteHit[][] {
  const stretches: NoteHit[][] = [];
  let endLine = -1;
  for (const hit of hits) {
    if (stretches.length > 0 && hit.line <= endLine)
      stretches[stretches.length - 1]!.push(hit);
    else stretches.push([hit]);
    endLine = Math.max(endLine, hit.endLine);
  }
  return stretches;
}

/**
 * What a replace-all *would* write, as one entry per affected line: the text
 * that survives, the text each hit takes away, and the text it puts there. The
 * note is not touched — this is the whole of the preview button.
 *
 * Untouched lines are left out entirely (a long note changed in two places is
 * two rows, not a wall of context), and an empty run is never emitted, so
 * replacing with nothing yields a `removed` with no `added` beside it. A hit
 * that spans a line break makes its lines **one** entry rather than two halves:
 * the break it swallows sits inside the `removed` run, where the panel draws it
 * struck through like the rest of what goes.
 */
export function previewReplacements(
  body: string,
  query: string,
  replacement: string,
  options: FindOptions = {},
): PreviewLine[] {
  const hits = findHits(body, query, options);
  if (hits.length === 0) return [];
  const template = expandTemplateEscapes(replacement, options);
  const starts = lineStarts(body);
  // The offset just past a line's last character — the next line's start minus
  // its break, or the end of the note for the last line.
  const lineEnd = (line: number) =>
    line + 1 < starts.length ? starts[line + 1]! - 1 : body.length;
  const preview: PreviewLine[] = [];
  for (const stretch of byStretch(hits)) {
    const line = stretch[0]!.line;
    const endLine = Math.max(...stretch.map((hit) => hit.endLine));
    const segments: PreviewSegment[] = [];
    let cursor = starts[line]!;
    const push = (kind: PreviewSegment["kind"], text: string) => {
      if (text !== "") segments.push({ kind, text });
    };
    for (const hit of stretch) {
      push("kept", body.slice(cursor, hit.start));
      push("removed", hit.match[0]);
      push("added", insertionFor(template, hit, options));
      cursor = hit.end;
    }
    push("kept", body.slice(cursor, lineEnd(endLine)));
    preview.push({ line, endLine, segments });
  }
  return preview;
}
