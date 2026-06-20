import type { Widen } from "./_widen.ts";

// User-visible strings for the notes shell itself — the header wordmark, the
// empty state, the editor placeholder, and the per-note controls in the
// full-screen editor. Lives here so the shell has a single i18n entry point.

const app = {
  title: "Notes",
  empty: "No notes yet. Tap + (or press Enter) to write your first one.",
  newNote: "New note",
  back: "Back",
  startWriting: "Start writing…",
  titlePlaceholder: "Title",
  // Heading of the collected attachments block at the foot of a note, shown
  // when images / files are set to render at the end rather than inline.
  attachments: "Attachments",
  // Drag-and-drop import overlay (desktop): shown while Markdown files are
  // dragged over the window.
  dropTitle: "Drop to import",
  dropHint:
    "Release to add your Markdown files as notes — each file's name becomes the note title.",
  // Swipe actions on a note card in the overview.
  archive: "Archive",
  archiveNote: "Archive note",
  delete: "Delete",
  // The editor's copy-to-clipboard button (left of the sync glyph). What it
  // copies is the copy-scope editor setting; see settings.editor.copy*.
  copy: {
    label: "Copy note",
    copied: "Copied",
  },
} as const;

export type AppCatalog = Widen<typeof app>;

export default app;
