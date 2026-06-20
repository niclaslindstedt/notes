// The note model: pure data + pure transforms, no DOM and no I/O. Keeping
// this layer framework-agnostic is what lets the future React Native app
// reuse the exact same logic (the eslint config enforces the no-ui /
// no-storage / no-DOM boundary). Storage and UI build on top of it.

import { type Attachment, referencedAttachments } from "./attachment.ts";

// A single note. `title` is a short heading the user edits in its own field
// (it is *not* the first body line); `body` is the plain text / Markdown
// below it. Both are stored — the title rides the markdown frontmatter so it
// survives a round-trip through any editor.
export type Note = {
  id: string;
  title: string;
  body: string;
  // Epoch milliseconds. `createdAt` is set once; `updatedAt` moves on
  // every edit and is what the list sorts by (most-recent first).
  createdAt: number;
  updatedAt: number;
  // Archived notes stay in the document but drop out of the overview list.
  // Swiping a note right in the overview marks it archived so it disappears
  // without being destroyed; the archive view (reached from the side menu)
  // lists them and offers a restore. Absent on an active note rather than
  // written as `false`, so an older document needs no migration.
  archived?: boolean;
  // Images the user pasted or dropped into the note. Each rides in memory as a
  // `data:` URL the editor renders; on the file backends the storage layer
  // externalises it to a real image file under `attachments/<note-name>/` (see
  // `domain/attachment.ts`). Absent on a note with no images rather than an
  // empty array, so an older document needs no migration and a JSON note with
  // none stays minimal.
  attachments?: Attachment[];
};

// Cheap, collision-resistant id. `crypto.randomUUID` is available in every
// browser the app targets and in the test runner's node environment.
export function newNoteId(): string {
  return crypto.randomUUID();
}

/** Create an empty note stamped at `now` (defaults to the current time). */
export function createNote(now: number = Date.now()): Note {
  return {
    id: newNoteId(),
    title: "",
    body: "",
    createdAt: now,
    updatedAt: now,
  };
}

// Return a copy of `note` with a new body and a bumped `updatedAt`. Erasing an
// attachment's `![](attachments/…)` / `[file](attachments/…)` reference from
// the body orphans its attachment, so any attachment the new body no longer
// references is dropped here — the body is the source of truth for which
// attachments the note keeps. This is what makes a deleted attachment shed its
// bytes from the document (and, on the file backends, lets the next save
// reconcile the on-disk file away).
export function editNote(
  note: Note,
  body: string,
  now: number = Date.now(),
): Note {
  const next: Note = { ...note, body, updatedAt: now };
  if (note.attachments && note.attachments.length > 0) {
    const kept = referencedAttachments(body, note.attachments);
    if (kept.length !== note.attachments.length) {
      next.attachments = kept.length > 0 ? kept : undefined;
    }
  }
  return next;
}

/** Return a copy of `note` with a new title and a bumped `updatedAt`. */
export function retitleNote(
  note: Note,
  title: string,
  now: number = Date.now(),
): Note {
  return { ...note, title, updatedAt: now };
}

// Return a copy of `note` marked archived (hidden from the overview) or
// active again, without destroying it. `updatedAt` is left untouched so a
// restored note keeps its place in the most-recently-edited ordering rather
// than jumping to the top.
export function setArchived(note: Note, archived: boolean): Note {
  return { ...note, archived };
}

/** The notes shown in the overview — everything not archived. */
export function activeNotes(notes: readonly Note[]): Note[] {
  return notes.filter((n) => !n.archived);
}

/** The notes shown in the archive view — everything marked archived. */
export function archivedNotes(notes: readonly Note[]): Note[] {
  return notes.filter((n) => n.archived);
}

// The title shown in the list, trimmed. Falls back to a placeholder so a note
// that only has a body (no title yet) is still legible.
export function noteTitle(note: Note): string {
  return note.title.trim() || "Untitled note";
}

// Attachment markdown: an image reference (`![alt](…)`, any image) or a file
// reference (`[file](attachments/…)`). Both are noise in a one-line text
// excerpt, so they're stripped from the preview rather than shown as raw
// syntax. A normal link (`[text](https://…)`) is left alone — only links into
// the `attachments/` tree are dropped.
const IMAGE_MARKDOWN_RE = /!\[[^\]]*\]\([^)]*\)/g;
const FILE_ATTACHMENT_MARKDOWN_RE = /\[[^\]]*\]\([^)]*attachments\/[^)]*\)/g;

// A one-line preview of the body below the title, collapsed to a single
// spaced string, with attachment markdown removed (it adds nothing to a text
// excerpt and would otherwise show as `![…](…)` clutter).
export function notePreview(note: Note): string {
  return note.body
    .replace(IMAGE_MARKDOWN_RE, " ")
    .replace(FILE_ATTACHMENT_MARKDOWN_RE, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join(" ");
}

/** True when a note carries no user content and is safe to discard. */
export function isBlank(note: Note): boolean {
  return (
    note.title.trim().length === 0 &&
    note.body.trim().length === 0 &&
    (note.attachments?.length ?? 0) === 0
  );
}

// Sort newest-edited first. Returns a new array; never mutates the input.
export function sortByUpdated(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
}

// How a freshly created note is named. `none` leaves the title empty (the user
// names it, or the "Untitled note" fallback shows); `dateTime` stamps the
// creation date and time; `numbered` picks the next free "Note" / "Note 2" /
// "Note 3" … name. The choice is a synced editor setting.
export type DefaultTitleScheme = "none" | "dateTime" | "numbered";

export const DEFAULT_TITLE_SCHEMES: readonly DefaultTitleScheme[] = [
  "none",
  "dateTime",
  "numbered",
];

export function isDefaultTitleScheme(v: unknown): v is DefaultTitleScheme {
  return v === "none" || v === "dateTime" || v === "numbered";
}

// What the editor's copy button writes to the clipboard. `body` copies the
// note body verbatim (the default — just what you wrote, no title); `titleBody`
// prepends the title as a Markdown `# ` heading; `frontMatter` copies the whole
// `.md` file the way it's stored on the file/cloud backends — the YAML
// frontmatter block (id, title, timestamps) followed by the body. The choice is
// a synced editor setting; the copy menu also writes through it so the button
// remembers your last pick.
export type CopyScope = "body" | "titleBody" | "frontMatter";

export const COPY_SCOPES: readonly CopyScope[] = [
  "body",
  "titleBody",
  "frontMatter",
];

export function isCopyScope(v: unknown): v is CopyScope {
  return v === "body" || v === "titleBody" || v === "frontMatter";
}

// Existing "Note" (= 1) / "Note 12" titles, used to find the next free index.
const NUMBERED_TITLE_RE = /^Note(?: (\d+))?$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// `YYYY-MM-DD HH:mm` in local time — sorts naturally, reads cleanly, and makes
// a stable filename slug on the file / cloud backends.
function dateTimeTitle(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// The next free "Note" / "Note 2" / … name given the notes already present.
function nextNumberedTitle(notes: readonly Note[]): string {
  let max = 0;
  for (const n of notes) {
    const m = NUMBERED_TITLE_RE.exec(n.title.trim());
    if (!m) continue;
    const idx = m[1] === undefined ? 1 : Number(m[1]);
    if (idx > max) max = idx;
  }
  const next = max + 1;
  return next === 1 ? "Note" : `Note ${next}`;
}

// The title a new note opens with under the chosen scheme. `none` returns an
// empty string (the note stays blank until typed into). Pure: numbering reads
// the notes already present, the timestamp reads `now`.
export function defaultNoteTitle(
  scheme: DefaultTitleScheme,
  notes: readonly Note[],
  now: number = Date.now(),
): string {
  switch (scheme) {
    case "dateTime":
      return dateTimeTitle(now);
    case "numbered":
      return nextNumberedTitle(notes);
    default:
      return "";
  }
}

// The whole persisted document the storage layer moves in and out of a
// backend: just the list of notes. Kept version-free here on purpose —
// versioning is a property of the bytes at rest, so it lives in
// `storage/migrations.ts` / `storage/serialize.ts`, and `domain/` only ever
// sees this shape. A `Snapshot` is the unit a backend stores; the markdown
// codec splits it into one file per note, and the JSON codec writes it whole.
export type Snapshot = {
  notes: Note[];
};

/** An empty document — the fallback for a first run or an unreadable blob. */
export function emptySnapshot(): Snapshot {
  return { notes: [] };
}

// How a note's body is tidied each time it is persisted ("format on save").
// Both default on. The normalisation is applied to the *stored* bytes only —
// the in-memory body the editor holds stays exactly as typed, so trimming
// never fights the caret (the live-preview editor treats a body that differs
// from what it echoed as another writer's edit and would clobber the keystroke
// otherwise). The tidied form lands in memory the next time the note is read
// back from the backend. The synced editor settings carry the two flags.
export type SaveFormatting = {
  // Strip trailing spaces / tabs from the end of every line.
  trimTrailingSpaces: boolean;
  // Ensure the body ends with a single trailing newline (the POSIX text-file
  // convention), without disturbing a body that already does.
  trailingNewline: boolean;
};

export const DEFAULT_SAVE_FORMATTING: SaveFormatting = {
  trimTrailingSpaces: true,
  trailingNewline: true,
};

// Tidy one note body per the chosen formatting. Pure; an empty body is left
// empty (no newline is forced onto a note with nothing in it).
export function formatBody(body: string, fmt: SaveFormatting): string {
  let out = body;
  // `$` under the `m` flag matches before each newline and at the very end, so
  // this clears trailing whitespace on every line including the last.
  if (fmt.trimTrailingSpaces) out = out.replace(/[ \t]+$/gm, "");
  if (fmt.trailingNewline && out.length > 0 && !out.endsWith("\n")) {
    out += "\n";
  }
  return out;
}

// Apply `formatBody` across a snapshot's notes, returning the same snapshot
// reference when nothing changed so an unaffected save doesn't churn identity.
export function formatSnapshotForSave(
  snapshot: Snapshot,
  fmt: SaveFormatting,
): Snapshot {
  if (!fmt.trimTrailingSpaces && !fmt.trailingNewline) return snapshot;
  let changed = false;
  const notes = snapshot.notes.map((note) => {
    const body = formatBody(note.body, fmt);
    if (body === note.body) return note;
    changed = true;
    return { ...note, body };
  });
  return changed ? { ...snapshot, notes } : snapshot;
}
