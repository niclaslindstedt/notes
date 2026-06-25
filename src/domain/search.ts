// Full-text search over the persisted document. Pure functions over the note
// model — no DOM, no I/O — so the whole engine is unit-testable and obeys the
// `src/domain/` purity rule (see CLAUDE.md).
//
// Two halves:
//   • `buildSearchIndex` flattens a `Snapshot` into a flat list of searchable
//     entries — one for each note's title and one for its body text. Archived
//     notes are skipped: a result opens the note in the editor, and an archived
//     note isn't in the overview to open.
//   • `search` parses the query and tests every entry, returning the matches
//     grouped per note with the character ranges that matched so the UI can
//     highlight them in place.
//
// **Lazy encryption fit.** On the encrypted file/cloud backends a note's `body`
// is deferred (loaded only when the note is opened — see `note.ts`), so a plain
// scan of `note.body` would find nothing in a locked-but-unloaded vault. The
// fix is to search through `notePreviewBlock`, the same projection the encrypted
// **note index** already stores per note (`storage/note-index.ts`): for a loaded
// note it is the body itself (whitespace-normalised, attachment markdown
// stripped), and for a deferred note it falls back to the `preview` the index
// carried at seal time. So the index the file backends build *is* the search
// corpus — full-text search works across every note, encrypted or not, without
// decrypting a single body up front or bloating the index.
//
// The query language is progressive:
//   • `/pattern/flags` → a JavaScript regular expression (an invalid one is
//     reported back so the UI can say so rather than silently finding nothing).
//   • a bare term containing `*` or `?` → shell-style wildcards (`*` = any run,
//     `?` = any single character), matched anywhere in the text.
//   • anything else → a plain case-insensitive substring match, and when that
//     finds nothing, a fuzzy subsequence match (the query's letters in order
//     but not necessarily adjacent), so a quick "abbreviation" still surfaces
//     the note.

import { notePreviewBlock, type Snapshot } from "./note.ts";

/** Which part of a note an entry came from. */
export type SearchField = "title" | "body";

/** One searchable piece of text, tagged with where it lives. */
export interface SearchEntry {
  noteId: string;
  /** The note's raw title, for context in the result row (may be empty). */
  noteTitle: string;
  field: SearchField;
  /** The text actually searched and highlighted. */
  text: string;
}

/** The flattened, searchable projection of a snapshot. */
export interface SearchIndex {
  entries: SearchEntry[];
}

/** A half-open `[start, end)` range of matched characters within a text. */
export type MatchRange = [number, number];

/** A note's matched body text, ready to render (already clipped by the UI). */
export interface BodyMatch {
  text: string;
  ranges: MatchRange[];
}

/** One note's matches, ready to render as a result row. */
export interface NoteResult {
  noteId: string;
  /** The note's raw title (empty when never titled — the UI shows a fallback). */
  title: string;
  /** Ranges within the title when it matched, else null. */
  titleRanges: MatchRange[] | null;
  /** The body match when the body matched, else null. */
  body: BodyMatch | null;
  /** Best single-match score — drives result ordering. */
  score: number;
}

/** The outcome of a search: ordered results, plus whether the regex was bad. */
export interface SearchOutcome {
  results: NoteResult[];
  /** True when the query was a `/…/` regex that failed to compile. */
  invalidRegex: boolean;
}

// ── Index ──────────────────────────────────────────────────────────────

/**
 * Flatten a snapshot into searchable entries: one per note title and one per
 * note body. The body text comes from `notePreviewBlock`, so a deferred
 * (encrypted, not-yet-opened) note is searched through the preview the note
 * index carried — see the lazy-encryption note at the top. Archived notes are
 * omitted. Empty title / body fields produce no entry (nothing to match).
 */
export function buildSearchIndex(snapshot: Snapshot): SearchIndex {
  const entries: SearchEntry[] = [];
  for (const note of snapshot.notes) {
    if (note.archived) continue;
    if (note.title.trim()) {
      entries.push({
        noteId: note.id,
        noteTitle: note.title,
        field: "title",
        text: note.title,
      });
    }
    const body = notePreviewBlock(note);
    if (body.trim()) {
      entries.push({
        noteId: note.id,
        noteTitle: note.title,
        field: "body",
        text: body,
      });
    }
  }
  return { entries };
}

// ── Query parsing ──────────────────────────────────────────────────────

type Matcher =
  | { kind: "regex"; re: RegExp }
  | { kind: "wildcard"; re: RegExp }
  | { kind: "text"; needle: string };

type ParsedQuery =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "matcher"; matcher: Matcher };

const REGEX_LITERAL = /^\/(.+)\/([a-z]*)$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Escape a wildcard term, mapping `*`→`.*` and `?`→`.` but escaping the rest. */
function wildcardToRegExp(term: string): RegExp {
  const body = term
    .split("")
    .map((ch) => (ch === "*" ? ".*" : ch === "?" ? "." : escapeRegExp(ch)))
    .join("");
  return new RegExp(body, "giu");
}

export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "empty" };

  const asRegex = REGEX_LITERAL.exec(trimmed);
  if (asRegex) {
    const [, body, flags] = asRegex;
    // Force `g` (so `matchAll` walks every hit) and `i` (case-insensitive),
    // keeping any extra flags the user added (e.g. `s`, `u`).
    const wanted = new Set((flags ?? "").split(""));
    wanted.add("g");
    wanted.add("i");
    try {
      return {
        kind: "matcher",
        matcher: { kind: "regex", re: new RegExp(body!, [...wanted].join("")) },
      };
    } catch {
      return { kind: "invalid" };
    }
  }

  if (trimmed.includes("*") || trimmed.includes("?")) {
    return {
      kind: "matcher",
      matcher: { kind: "wildcard", re: wildcardToRegExp(trimmed) },
    };
  }

  return { kind: "matcher", matcher: { kind: "text", needle: trimmed } };
}

// ── Matching ───────────────────────────────────────────────────────────

interface Match {
  ranges: MatchRange[];
  score: number;
}

/** Merge overlapping/adjacent ranges so the UI never double-marks a span. */
function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: MatchRange[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1]!;
    const cur = sorted[i]!;
    if (cur[0] <= last[1]) last[1] = Math.max(last[1], cur[1]);
    else out.push(cur);
  }
  return out;
}

function matchRegExp(text: string, re: RegExp): Match | null {
  const ranges: MatchRange[] = [];
  // Clone so concurrent uses of a shared RegExp don't fight over lastIndex.
  const g = new RegExp(
    re.source,
    re.flags.includes("g") ? re.flags : re.flags + "g",
  );
  for (const m of text.matchAll(g)) {
    if (m.index === undefined) continue;
    // A zero-width match (e.g. `a*`) can't be highlighted and would loop —
    // skip it but still count the entry as a (weak) hit.
    if (m[0].length === 0) continue;
    ranges.push([m.index, m.index + m[0].length]);
  }
  if (ranges.length === 0) return null;
  const merged = mergeRanges(ranges);
  // Earlier + more matches rank higher.
  const score = 600 - Math.min(merged[0]![0], 500) + merged.length;
  return { ranges: merged, score };
}

function matchSubstring(text: string, needle: string): Match | null {
  const haystack = text.toLowerCase();
  const lowNeedle = needle.toLowerCase();
  const ranges: MatchRange[] = [];
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(lowNeedle, from);
    if (idx === -1) break;
    ranges.push([idx, idx + lowNeedle.length]);
    from = idx + lowNeedle.length;
  }
  if (ranges.length === 0) return null;
  // A whole-text or word-start match scores best; otherwise earlier is better.
  const first = ranges[0]![0];
  const wholeWord = first === 0 || /\s/.test(text[first - 1] ?? "");
  const score =
    1000 - Math.min(first, 500) + (wholeWord ? 200 : 0) + ranges.length;
  return { ranges: mergeRanges(ranges), score };
}

/**
 * Fuzzy subsequence: every character of `needle` appears in `text` in order
 * (not necessarily adjacent). Highlights each matched character and scores by
 * how tightly packed the run is, so `grcl` ranks "grocery list" above a
 * scattered coincidence. Single-character queries don't fuzzy-match (too
 * noisy) — the substring pass already covers those.
 */
function matchFuzzy(text: string, needle: string): Match | null {
  if (needle.length < 2) return null;
  const haystack = text.toLowerCase();
  const lowNeedle = needle.toLowerCase();
  const ranges: MatchRange[] = [];
  let ti = 0;
  let firstIdx = -1;
  let lastIdx = -1;
  for (let ni = 0; ni < lowNeedle.length; ni++) {
    const ch = lowNeedle[ni]!;
    if (ch === " ") continue; // spaces in the query are separators, not chars
    let found = -1;
    while (ti < haystack.length) {
      if (haystack[ti] === ch) {
        found = ti;
        ti++;
        break;
      }
      ti++;
    }
    if (found === -1) return null;
    if (firstIdx === -1) firstIdx = found;
    lastIdx = found;
    // Extend a contiguous range rather than emitting one per character.
    const last = ranges[ranges.length - 1];
    if (last && last[1] === found) last[1] = found + 1;
    else ranges.push([found, found + 1]);
  }
  if (ranges.length === 0) return null;
  const span = lastIdx - firstIdx + 1;
  const compactness = Math.max(0, 200 - (span - lowNeedle.length) * 8);
  const score = 100 + compactness - Math.min(firstIdx, 100);
  return { ranges: mergeRanges(ranges), score };
}

function matchEntry(text: string, matcher: Matcher): Match | null {
  switch (matcher.kind) {
    case "regex":
    case "wildcard":
      return matchRegExp(text, matcher.re);
    case "text":
      return (
        matchSubstring(text, matcher.needle) ?? matchFuzzy(text, matcher.needle)
      );
  }
}

// ── Search ─────────────────────────────────────────────────────────────

/**
 * Run `raw` against the index, grouping the hits per note. A title hit fills
 * `titleRanges`; a body hit fills `body`. Results are ordered by their best
 * match score (then title); ties keep document order. An empty query yields no
 * results; an invalid `/…/` regex sets `invalidRegex` so the UI can explain the
 * empty result.
 */
export function search(index: SearchIndex, raw: string): SearchOutcome {
  const parsed = parseQuery(raw);
  if (parsed.kind === "empty") return { results: [], invalidRegex: false };
  if (parsed.kind === "invalid") return { results: [], invalidRegex: true };
  const { matcher } = parsed;

  // noteId → accumulating result, kept in first-seen (document) order.
  const groups = new Map<string, NoteResult>();
  const order: string[] = [];
  const groupFor = (e: SearchEntry): NoteResult => {
    let g = groups.get(e.noteId);
    if (!g) {
      g = {
        noteId: e.noteId,
        title: e.noteTitle,
        titleRanges: null,
        body: null,
        score: 0,
      };
      groups.set(e.noteId, g);
      order.push(e.noteId);
    }
    return g;
  };

  for (const entry of index.entries) {
    const m = matchEntry(entry.text, matcher);
    if (!m) continue;
    const g = groupFor(entry);
    g.score = Math.max(g.score, m.score);
    if (entry.field === "title") {
      g.titleRanges = m.ranges;
      // A title hit is worth a little extra so the note surfaces near the top.
      g.score = Math.max(g.score, m.score + 50);
    } else {
      g.body = { text: entry.text, ranges: m.ranges };
    }
  }

  const results = order.map((id) => groups.get(id)!);
  results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return { results, invalidRegex: false };
}

/**
 * Split `text` into alternating plain / highlighted segments from a set of
 * match ranges, so a renderer can wrap only the matched spans. Ranges are
 * assumed sorted and non-overlapping (as `search` returns them).
 */
export function segmentMatches(
  text: string,
  ranges: MatchRange[],
): { text: string; match: boolean }[] {
  if (ranges.length === 0) return [{ text, match: false }];
  const out: { text: string; match: boolean }[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor)
      out.push({ text: text.slice(cursor, start), match: false });
    out.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length)
    out.push({ text: text.slice(cursor), match: false });
  return out;
}
