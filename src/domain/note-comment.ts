// **Line comments**: a note about a line, kept beside the note rather than in
// it. Pure data + pure transforms, no DOM and no I/O, like everything else in
// `domain/`.
//
// A comment is an annotation, not text: the reviewer's "is this still true?",
// the reminder that a paragraph needs a source. Writing it *into* the body
// would change the thing being annotated — it would export, it would print, it
// would be read by every tool that opens the markdown. So a comment rides the
// note's own metadata and is written into the file's YAML frontmatter, where a
// markdown reader shows it as the document's front block and a renderer drops
// it entirely (see `storage/markdown/codec.ts`).
//
// **What a comment is anchored to is a set of lines, not a range.** Select mode
// hands over whatever the user picked, and what they picked need not be one
// unbroken run — the two headings and nothing between them is as ordinary a
// pick as three lines in a row (see `domain/line-selection.ts`). So a comment
// holds the line indices themselves, and the gutter draws its bubble on exactly
// the lines it was given.

/**
 * One comment, anchored to the lines it was written against.
 *
 * `lines` is 0-based, ascending, without duplicates, and never empty — a
 * comment with nothing left to point at is dropped rather than kept pointing
 * nowhere (see `remapComments`). The indices are the *source* lines of the
 * note's body, the same coordinates the gutter numbers and select mode picks
 * in; the frontmatter writes them one-based, so a hand-edited file reads the
 * numbers the gutter shows (see `formatCommentLines`).
 */
export type LineComment = {
  id: string;
  lines: readonly number[];
  text: string;
  /** Epoch milliseconds, set once. */
  createdAt: number;
  /** Epoch milliseconds, moved by every edit of the comment's text. */
  updatedAt: number;
};

/**
 * Cheap, collision-resistant id, the same source `newNoteId` draws on.
 * Exported because the markdown codec mints one for a comment somebody wrote
 * into a synced file by hand, without an `id:` of its own.
 */
export function newCommentId(): string {
  return crypto.randomUUID();
}

function ascending(lines: Iterable<number>): number[] {
  return [...new Set(lines)].sort((a, b) => a - b);
}

/**
 * A fresh comment over `lines`. The indices are normalised (ascending, unique,
 * negatives dropped) so every later pass can read them without re-checking.
 * Returns null when nothing survives that — a comment has to point somewhere.
 */
export function newComment(
  lines: Iterable<number>,
  text: string,
  now: number = Date.now(),
): LineComment | null {
  const at = ascending(lines).filter((n) => Number.isInteger(n) && n >= 0);
  if (at.length === 0) return null;
  const body = text.trim();
  if (!body) return null;
  return {
    id: newCommentId(),
    lines: at,
    text: body,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * `comments` with `comment` added, kept in the order the lines run down the
 * note so the modal and the export read top to bottom rather than in the order
 * they happened to be written.
 */
export function addComment(
  comments: readonly LineComment[] | undefined,
  comment: LineComment,
): LineComment[] {
  return sortComments([...(comments ?? []), comment]);
}

/**
 * `comments` with the named one carrying `text` instead, stamped at `now`. An
 * empty text removes the comment — clearing the field in the modal is how a
 * comment is deleted, and leaving an empty one behind would draw a bubble with
 * nothing in it. An unchanged text is a no-op: the same array comes back, so
 * the note is never churned (and never re-saved) by a modal the user opened and
 * closed without typing.
 */
export function updateCommentText(
  comments: LineComment[] | undefined,
  id: string,
  text: string,
  now: number = Date.now(),
): LineComment[] {
  const body = text.trim();
  if (!body) return removeComment(comments, id);
  const list = comments ?? [];
  if (!list.some((c) => c.id === id && c.text !== body)) return list;
  return list.map((c) =>
    c.id === id ? { ...c, text: body, updatedAt: now } : c,
  );
}

/** `comments` without the named one. */
export function removeComment(
  comments: readonly LineComment[] | undefined,
  id: string,
): LineComment[] {
  return (comments ?? []).filter((c) => c.id !== id);
}

/** Comments in the order their first line runs down the note. */
export function sortComments(comments: readonly LineComment[]): LineComment[] {
  return [...comments].sort(
    (a, b) =>
      (a.lines[0] ?? 0) - (b.lines[0] ?? 0) || a.createdAt - b.createdAt,
  );
}

/** The comments anchored to `line`, in note order. */
export function commentsOnLine(
  comments: readonly LineComment[] | undefined,
  line: number,
): LineComment[] {
  return (comments ?? []).filter((c) => c.lines.includes(line));
}

/**
 * Every line carrying at least one comment — what the gutter asks once per
 * render rather than walking the list per line.
 */
export function commentedLines(
  comments: readonly LineComment[] | undefined,
): Set<number> {
  const out = new Set<number>();
  for (const c of comments ?? []) for (const n of c.lines) out.add(n);
  return out;
}

/** Whether any note in the document carries a comment (the achievement's ask). */
export function hasComments(
  comments: readonly LineComment[] | undefined,
): boolean {
  return (comments ?? []).length > 0;
}

// -- Anchors across an edit -------------------------------------------
//
// A comment names a line by its index, so every edit that adds or removes a
// line moves the lines below it out from under whatever was pointing at them.
// `remapComments` is the single answer to that, applied wherever a body is
// rewritten (`editNote`), so no caller has to remember.
//
// The diff is the cheap one: the run of identical lines at the head, the run of
// identical lines at the foot, and the rewritten region between them. That is
// exactly right for what actually happens to a note — a line typed into the
// middle, a run deleted, a paste — and it costs one scan of the line arrays.
//
// **Typing inside a line never moves an anchor**, because the line count didn't
// change; that is the overwhelmingly common edit and it is free. **Moving lines
// leaves comments where they were**, for the same reason: the note still has
// the same number of lines, so the diff sees no shift to apply, and the comment
// stays on the row it named rather than following the text that used to be
// there. That is a deliberate limit, not an oversight — a remap that chases
// content would have to guess which of two identical lines is "the" one.

/**
 * `comments` re-anchored from the body `prev` to the body `next`.
 *
 * A comment on a line above the edit is untouched; one below it shifts by the
 * change in line count; one anchored to a line the edit deleted loses that
 * line, and a comment that loses every line it had is dropped entirely — a
 * comment on text that no longer exists has nothing to say. Returns the same
 * array reference when nothing moved, so a keystroke inside a line doesn't
 * churn the note's identity.
 */
export function remapComments(
  prev: string,
  next: string,
  comments: LineComment[] | undefined,
): LineComment[] | undefined {
  const list = comments;
  if (!list || list.length === 0) return list;
  if (prev === next) return list;
  const before = prev.split("\n");
  const after = next.split("\n");
  const delta = after.length - before.length;
  // Same number of lines: whatever changed, changed *within* lines, and every
  // index still names the row it always did.
  if (delta === 0) return list;

  let head = 0;
  while (
    head < before.length &&
    head < after.length &&
    before[head] === after[head]
  ) {
    head += 1;
  }
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }
  // The rewritten region of the *old* body: `[head, changedEnd)`. Everything at
  // or past `changedEnd` survives, shifted by `delta`.
  const changedEnd = before.length - tail;
  // And of the new body — the rows the region still has to give. A deletion
  // leaves fewer than it took, and an old line past this point is gone.
  const survivesTo = changedEnd + delta;
  const last = after.length - 1;

  const out: LineComment[] = [];
  for (const comment of list) {
    const moved: number[] = [];
    for (const line of comment.lines) {
      if (line < head) moved.push(line);
      else if (line >= changedEnd) moved.push(line + delta);
      else if (line < survivesTo) moved.push(line);
      // Otherwise the line itself was deleted, and the comment loses it.
    }
    const clamped = ascending(moved.map((n) => Math.min(Math.max(n, 0), last)));
    // Every line it had is gone: the comment goes with them.
    if (clamped.length === 0) continue;
    out.push({ ...comment, lines: clamped });
  }
  return sortComments(out);
}

// -- The frontmatter's line list --------------------------------------
//
// On disk a comment's anchor is written the way a person would write it —
// `3,7-9`, one-based, the numbers the gutter shows — rather than as the
// zero-based array the app holds. The file is meant to be readable in any
// editor: someone who opens the `.md` and sees `lines: 12` should be able to
// scroll to line 12 and find what the comment is about.

/**
 * `lines` (0-based) as the one-based, comma-separated ranges the frontmatter
 * carries: `[2]` → `"3"`, `[2,4,5,6]` → `"3,5-7"`.
 */
export function formatCommentLines(lines: readonly number[]): string {
  const at = ascending(lines);
  const parts: string[] = [];
  let i = 0;
  while (i < at.length) {
    const start = at[i]!;
    let end = start;
    while (i + 1 < at.length && at[i + 1] === end + 1) {
      i += 1;
      end = at[i]!;
    }
    parts.push(start === end ? `${start + 1}` : `${start + 1}-${end + 1}`);
    i += 1;
  }
  return parts.join(",");
}

/**
 * The inverse: a one-based `"3,5-7"` back to the 0-based `[2,4,5,6]`. Junk is
 * skipped rather than failing the parse — a hand-edited file with a typo in one
 * comment must still load every other comment, and the note itself above all.
 */
export function parseCommentLines(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(",")) {
    const range = part.trim();
    if (!range) continue;
    const [fromRaw, toRaw] = range.split("-", 2);
    const from = Number(fromRaw);
    if (!Number.isInteger(from) || from < 1) continue;
    const to = toRaw === undefined ? from : Number(toRaw);
    if (!Number.isInteger(to) || to < from) {
      out.push(from - 1);
      continue;
    }
    // A hand-written `1-100000` must not allocate a hundred thousand entries;
    // the anchor is clamped to something a note could plausibly hold.
    for (let n = from; n <= Math.min(to, from + MAX_RANGE); n += 1) {
      out.push(n - 1);
    }
  }
  return ascending(out);
}

// How many lines one written range may expand to. Generous for any real note,
// bounded against a typo (or a hostile file) turning into an allocation.
const MAX_RANGE = 10_000;

/**
 * Read a stored `comments` value back defensively: drop any entry that isn't a
 * usable comment rather than failing the note it belongs to, the same stance
 * `parse` takes for notes and attachments. A missing or non-array value yields
 * none.
 *
 * Every entry is rebuilt field by field in a fixed key order rather than spread
 * through, which is what keeps the encrypted backends' content hash stable: a
 * note whose comments were re-read from disk must re-serialize to the identical
 * bytes, or every load would look like an edit and re-upload the note.
 */
export function parseComments(value: unknown): LineComment[] {
  if (!Array.isArray(value)) return [];
  const out: LineComment[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const c = entry as Record<string, unknown>;
    if (typeof c.id !== "string" || !c.id) continue;
    if (typeof c.text !== "string" || !c.text.trim()) continue;
    if (!Array.isArray(c.lines)) continue;
    const lines = ascending(
      c.lines.filter(
        (n): n is number =>
          typeof n === "number" && Number.isInteger(n) && n >= 0,
      ),
    );
    if (lines.length === 0) continue;
    const createdAt = typeof c.createdAt === "number" ? c.createdAt : 0;
    const updatedAt = typeof c.updatedAt === "number" ? c.updatedAt : createdAt;
    out.push({ id: c.id, lines, text: c.text, createdAt, updatedAt });
  }
  return sortComments(out);
}
