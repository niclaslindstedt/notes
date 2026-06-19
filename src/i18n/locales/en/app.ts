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
} as const;

export type AppCatalog = Widen<typeof app>;

export default app;
