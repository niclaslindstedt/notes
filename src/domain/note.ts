// The note model: pure data + pure transforms, no DOM and no I/O. Keeping
// this layer framework-agnostic is what lets the future React Native app
// reuse the exact same logic (the eslint config enforces the no-ui /
// no-storage / no-DOM boundary). Storage and UI build on top of it.

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

/** Return a copy of `note` with a new body and a bumped `updatedAt`. */
export function editNote(
  note: Note,
  body: string,
  now: number = Date.now(),
): Note {
  return { ...note, body, updatedAt: now };
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

// A one-line preview of the body below the title, collapsed to a single
// spaced string.
export function notePreview(note: Note): string {
  return note.body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ");
}

/** True when a note carries no user content and is safe to discard. */
export function isBlank(note: Note): boolean {
  return note.title.trim().length === 0 && note.body.trim().length === 0;
}

// Sort newest-edited first. Returns a new array; never mutates the input.
export function sortByUpdated(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
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
