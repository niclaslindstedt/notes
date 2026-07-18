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
  // The note's text below the title. **Optional** because the encrypted
  // file/cloud backends load lazily: on unlock the list is rebuilt from a small
  // encrypted index (titles + a `preview` snippet) and each note's body stays
  // `undefined` ("deferred") until the note is opened, when it is decrypted on
  // demand (`StorageAdapter.fetchNoteBody`). `undefined` means **not loaded
  // yet** — distinct from `""` (loaded and empty) — so a deferred note must
  // never be written back (it would clobber the real body with nothing); the
  // save planner skips it. A freshly created or plaintext-loaded note always
  // has a string body.
  body?: string;
  // A denormalised one-paragraph excerpt of the body, carried only while `body`
  // is deferred so the list still renders real preview text without decrypting
  // the note. Built at save time by `notePreviewBlock` and stored in the
  // encrypted index; ignored once the real `body` is present (the preview is
  // then recomputed from it).
  preview?: string;
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
  // The folder this note sits in within the namespace, by `Folder.id`. A note
  // with no `folderId` lives at the top level (ungrouped). Folders group notes
  // *inside* a namespace (a namespace's "Login feature", "Vacation 2025", …);
  // the registry of folders rides on the `Snapshot`. Absent on an ungrouped
  // note rather than written as `null`, so an older document needs no migration
  // and a note with no folder stays minimal. On the file backends it rides the
  // markdown frontmatter so the grouping survives a round-trip.
  folderId?: string;
};

// A folder: a named bucket grouping notes *within* a single namespace. The
// `id` is stable (a note points at it by `folderId`); the `name` is an
// editable label. A folder can be empty — it exists in the `Snapshot`'s
// folder registry independently of whether any note references it — so a
// freshly-created, still-unfilled folder persists. The whole model is pure
// and framework-free so the React Native app reuses it verbatim.
export type Folder = {
  id: string;
  name: string;
  // Epoch milliseconds, set once. Folders sort by creation order so the list
  // stays stable as notes move in and out.
  createdAt: number;
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
  // Opening a note and placing the caret can echo the body back unchanged
  // (e.g. the editor re-emitting the current source). An identical body is not
  // an edit, so leave the note — and crucially its `updatedAt` — untouched so
  // it keeps its place in the most-recently-edited ordering instead of jumping
  // to the top of the list.
  if (body === note.body) return note;
  const next: Note = { ...note, body, updatedAt: now };
  if (note.attachments && note.attachments.length > 0) {
    const kept = referencedAttachments(body, note.attachments);
    if (kept.length !== note.attachments.length) {
      next.attachments = kept.length > 0 ? kept : undefined;
    }
  }
  return next;
}

// Return a copy of `note` with a new title and a bumped `updatedAt`. The title
// is trimmed so a stored title can never start or end with a space — leading /
// trailing whitespace is never meaningful in a title and would otherwise leak
// into the file/cloud filename slug and the list ordering.
export function retitleNote(
  note: Note,
  title: string,
  now: number = Date.now(),
): Note {
  return { ...note, title: title.trim(), updatedAt: now };
}

/** Create an empty folder named `name`, stamped at `now`. The name is trimmed. */
export function createFolder(name: string, now: number = Date.now()): Folder {
  return { id: newNoteId(), name: name.trim(), createdAt: now };
}

// Return a copy of `note` moved into `folderId` (or out of any folder when
// `folderId` is undefined / null). `updatedAt` is left untouched: moving a note
// between folders is an organisational change, not an edit, so it keeps its
// place in the most-recently-edited ordering rather than jumping to the top.
// Returns the same note reference when the folder doesn't actually change so a
// no-op move doesn't churn identity.
export function setNoteFolder(
  note: Note,
  folderId: string | null | undefined,
): Note {
  const target = folderId || undefined;
  if ((note.folderId || undefined) === target) return note;
  const next: Note = { ...note };
  if (target) next.folderId = target;
  else delete next.folderId;
  return next;
}

/** Folders in stable creation order (oldest first). Never mutates the input. */
export function sortFoldersByCreated(folders: readonly Folder[]): Folder[] {
  return [...folders].sort((a, b) => a.createdAt - b.createdAt);
}

/** The notes that sit directly in `folderId` (or ungrouped when `null`). */
export function notesInFolder(
  notes: readonly Note[],
  folderId: string | null,
): Note[] {
  if (folderId === null) return notes.filter((n) => !n.folderId);
  return notes.filter((n) => n.folderId === folderId);
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
  // Deferred (body not loaded): fall back to the index-supplied snippet,
  // collapsed to a single line the way a loaded body would be.
  if (note.body === undefined) {
    return (note.preview ?? "")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line.length > 0)
      .join(" ");
  }
  return note.body
    .replace(IMAGE_MARKDOWN_RE, " ")
    .replace(FILE_ATTACHMENT_MARKDOWN_RE, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join(" ");
}

// A multi-line preview of the body, used by the card layout of the overview
// (see `notePreview` for the single-line row layout). Keeps the note's line
// breaks so the excerpt reads like the note itself — every non-empty line is
// trimmed and runs of blank lines are collapsed away — and the card clamps it
// to a fixed number of lines (ellipsis on overflow) in CSS. Attachment markdown
// is stripped the same way as the one-line preview.
export function notePreviewBlock(note: Note): string {
  // Deferred (body not loaded): the stored preview is already this block form.
  if (note.body === undefined) return note.preview ?? "";
  return note.body
    .replace(IMAGE_MARKDOWN_RE, " ")
    .replace(FILE_ATTACHMENT_MARKDOWN_RE, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/** True when a note carries no user content and is safe to discard. */
export function isBlank(note: Note): boolean {
  // A deferred note is one that already lives encrypted on disk, so it is by
  // definition not a pristine, discardable scratch note — never blank.
  if (note.body === undefined) return false;
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

// What the side menu sorts notes (and, under `mixed` placement, folders) by.
// `modified` keeps the most-recently-edited first (the historical order);
// `name` sorts alphabetically by title. A side-menu layout preference that
// rides alongside the appearance settings (re-exported from `theme/themes.ts`
// for the appearance store, but defined here next to its sibling preference
// types so the pure sort helpers below stay framework-free).
export type NoteSortKey = "modified" | "name";

export const NOTE_SORT_KEYS: readonly NoteSortKey[] = ["modified", "name"];

// Last-modified is the default — the drawer has always led with what you
// touched most recently.
export const DEFAULT_NOTE_SORT_KEY: NoteSortKey = "modified";

export function isNoteSortKey(v: unknown): v is NoteSortKey {
  return v === "modified" || v === "name";
}

// Sort notes for the drawer by the active key: most-recently-edited first, or
// alphabetically by title (case-insensitive). Never mutates the input.
export function sortNotesBy(notes: readonly Note[], key: NoteSortKey): Note[] {
  if (key === "name") {
    return [...notes].sort((a, b) =>
      noteTitle(a).localeCompare(noteTitle(b), undefined, {
        sensitivity: "base",
      }),
    );
  }
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
}

// A folder's effective "modified" time: the newest `updatedAt` among the notes
// filed in it, falling back to its own creation time when it's empty. Lets a
// folder sort by recency against loose notes under `mixed` placement.
export function folderModifiedAt(
  folder: Folder,
  notes: readonly Note[],
): number {
  let max = folder.createdAt;
  for (const n of notes) {
    if (n.folderId === folder.id && n.updatedAt > max) max = n.updatedAt;
  }
  return max;
}

// Folders ordered by the active key — alphabetically by name, or by their
// most-recently-edited note. Never mutates the input.
export function sortFoldersBy(
  folders: readonly Folder[],
  notes: readonly Note[],
  key: NoteSortKey,
): Folder[] {
  if (key === "name") {
    return [...folders].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  }
  return [...folders].sort(
    (a, b) => folderModifiedAt(b, notes) - folderModifiedAt(a, notes),
  );
}

// `mixed` placement: one interleaved run of folders and loose notes, sorted by
// the active key so a folder sits among the notes by its name or its newest
// note. `allNotes` is the full note set (used for a folder's modified time);
// `folders` and `loose` are the already-filtered, display-ordered inputs.
export type TopLevelItem =
  { kind: "folder"; folder: Folder } | { kind: "note"; note: Note };

export function mixTopLevel(
  folders: readonly Folder[],
  loose: readonly Note[],
  allNotes: readonly Note[],
  key: NoteSortKey,
): TopLevelItem[] {
  const items: TopLevelItem[] = [
    ...folders.map((folder) => ({ kind: "folder" as const, folder })),
    ...loose.map((note) => ({ kind: "note" as const, note })),
  ];
  items.sort((a, b) => {
    if (key === "name") {
      const an = a.kind === "folder" ? a.folder.name : noteTitle(a.note);
      const bn = b.kind === "folder" ? b.folder.name : noteTitle(b.note);
      return an.localeCompare(bn, undefined, { sensitivity: "base" });
    }
    const am =
      a.kind === "folder"
        ? folderModifiedAt(a.folder, allNotes)
        : a.note.updatedAt;
    const bm =
      b.kind === "folder"
        ? folderModifiedAt(b.folder, allNotes)
        : b.note.updatedAt;
    return bm - am;
  });
  return items;
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
  // The folders defined in this namespace, by which notes are grouped (a note
  // points at one by `Note.folderId`). Kept on the snapshot — not derived from
  // the notes — so an empty folder persists. Absent rather than an empty array
  // when no folders exist, so an older document needs no migration.
  folders?: Folder[];
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
    // A deferred note (body not loaded) is left exactly as-is — there is no
    // body in memory to tidy, and its stored form must not be touched.
    if (note.body === undefined) return note;
    const body = formatBody(note.body, fmt);
    if (body === note.body) return note;
    changed = true;
    return { ...note, body };
  });
  return changed ? { ...snapshot, notes } : snapshot;
}
