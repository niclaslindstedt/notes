import type { Widen } from "./_widen.ts";

// User-visible strings for the notes shell itself — the header wordmark, the
// empty state, the editor placeholder, and the per-note controls in the
// full-screen editor. Lives here so the shell has a single i18n entry point.

const app = {
  title: "Notes",
  empty: "No notes yet. Tap + (or press Enter) to write your first one.",
  newNote: "New note",
  back: "Back",
  deleteNote: "Delete note",
  startWriting: "Start writing…",
  titlePlaceholder: "Title",
  // Drag-and-drop import overlay (desktop): shown while Markdown files are
  // dragged over the window.
  dropTitle: "Drop to import",
  dropHint:
    "Release to add your Markdown files as notes — each file's name becomes the note title.",
  // Swipe actions on a note card in the overview.
  archive: "Archive",
  archiveNote: "Archive note",
  delete: "Delete",
} as const;

export type AppCatalog = Widen<typeof app>;

export default app;
