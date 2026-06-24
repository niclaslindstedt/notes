import type { Widen } from "./_widen.ts";

// User-visible strings for the notes shell itself — the header wordmark, the
// empty state, the editor placeholder, and the per-note controls in the
// full-screen editor. Lives here so the shell has a single i18n entry point.

const app = {
  title: "Notes",
  empty: "No notes yet. Tap + (or press Enter) to write your first one.",
  // Shown on the overview while the active namespace's first load is still in
  // flight (a folder/cloud round-trip), so switching into it shows "loading"
  // rather than the misleading empty prompt until the document lands.
  loading: "Loading notes…",
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
  // Accessible label for the desktop right-click menu that replaces the
  // swipe actions on a note row (overview card and side-menu row).
  noteActions: "Note actions",
  // The editor's copy-to-clipboard button (left of the sync glyph). What it
  // copies is the copy-scope editor setting; see settings.editor.copy*.
  copy: {
    label: "Copy note",
    copied: "Copied",
  },
  // Screen-reader label for the green lock shown on a note whose document and
  // every attachment are encrypted at rest.
  encryptedNote: "Encrypted at rest",
  // Screen-reader label for the spinner shown on a note whose file is being
  // uploaded to the backend right now.
  uploadingNote: "Syncing…",
  // Shown in the editor body while an opened note's text is being decrypted on
  // demand (the encrypted file/cloud backends load each body lazily, so opening
  // a note fetches and decrypts just that note's file).
  decrypting: "Decrypting…",
} as const;

export type AppCatalog = Widen<typeof app>;

export default app;
