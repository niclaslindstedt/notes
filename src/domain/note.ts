// The note model: pure data + pure transforms, no DOM and no I/O. Keeping
// this layer framework-agnostic is what lets the future React Native app
// reuse the exact same logic (the eslint config enforces the no-ui /
// no-storage / no-DOM boundary). Storage and UI build on top of it.

// A single note. `body` is plain text / Markdown; the title is derived
// from the first non-empty line rather than stored separately so there's
// one source of truth to keep in sync.
export type Note = {
  id: string;
  body: string;
  // Epoch milliseconds. `createdAt` is set once; `updatedAt` moves on
  // every edit and is what the list sorts by (most-recent first).
  createdAt: number;
  updatedAt: number;
};

// Cheap, collision-resistant id. `crypto.randomUUID` is available in every
// browser the app targets and in the test runner's node environment.
export function newNoteId(): string {
  return crypto.randomUUID();
}

/** Create an empty note stamped at `now` (defaults to the current time). */
export function createNote(now: number = Date.now()): Note {
  return { id: newNoteId(), body: "", createdAt: now, updatedAt: now };
}

/** Return a copy of `note` with a new body and a bumped `updatedAt`. */
export function editNote(
  note: Note,
  body: string,
  now: number = Date.now(),
): Note {
  return { ...note, body, updatedAt: now };
}

// The title shown in the list: the first non-empty line, trimmed. Falls
// back to a placeholder so a brand-new, still-empty note is still legible.
export function noteTitle(note: Note): string {
  const firstLine = note.body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ?? "Untitled note";
}

// A one-line preview of the body below the title: everything after the
// title line, collapsed to a single spaced string.
export function notePreview(note: Note): string {
  const lines = note.body.split("\n").map((line) => line.trim());
  const titleIndex = lines.findIndex((line) => line.length > 0);
  if (titleIndex === -1) return "";
  return lines
    .slice(titleIndex + 1)
    .filter((line) => line.length > 0)
    .join(" ");
}

/** True when a note carries no user content and is safe to discard. */
export function isBlank(note: Note): boolean {
  return note.body.trim().length === 0;
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
