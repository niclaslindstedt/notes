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
  // The editor's copy-to-clipboard button (last in the header cluster). What it
  // copies is the copy-scope editor setting; see settings.editor.copy*.
  copy: {
    label: "Copy note",
    copied: "Copied",
  },
  // The copy button in a fenced code block's top-right corner. It confirms
  // with the same "Copied" as the header's copy button above.
  copyCode: "Copy code",
  // Right-click menu entry on a note row: puts the note's own link on the
  // clipboard, so it can be bookmarked or sent to yourself.
  copyLink: "Copy link",
  // The editor's delete-line button (left of the copy button) and its
  // Ctrl/Cmd+K shortcut. Mid-line it clears only what follows the caret.
  deleteLine: "Delete line",
  // The styling toolbar: its header toggle, its accessible name, and one
  // label per button — each names the Markdown construct it applies, since
  // the buttons are glyph-only and the label is both tooltip and a11y name.
  format: {
    show: "Formatting",
    hide: "Hide formatting",
    toolbar: "Formatting",
    headings: "Heading",
    blocks: "Block style",
    inserts: "Insert",
    heading: "Heading {level}",
    bold: "Bold",
    italic: "Italic",
    strikethrough: "Strikethrough",
    code: "Inline code",
    bulletList: "Bullet list",
    numberedList: "Numbered list",
    quote: "Quote",
    codeBlock: "Code block",
    indent: "Indent",
    outdent: "Outdent",
    link: "Link",
    image: "Image",
    rule: "Divider",
  },
  // The find bar: the header toggle that raises it, the field's chrome, and
  // the match counter. It searches the open note only — verbatim and
  // case-insensitive — and is a different thing from the cross-note `search`
  // namespace (the magnifier on the side menu).
  find: {
    show: "Find in note",
    hide: "Close find",
    bar: "Find in note",
    placeholder: "Find in note…",
    previous: "Previous match",
    next: "Next match",
    close: "Close",
    count: "{index} of {total}",
    none: "No matches",
  },
  // Screen-reader label for the gray lock shown on a note that is encrypted at
  // rest but whose body hasn't been decrypted/loaded yet this session.
  encryptedNote: "Encrypted at rest",
  // Screen-reader label for the green lock shown on a note that is encrypted at
  // rest and whose body has been decrypted and loaded this session.
  encryptedNoteLoaded: "Encrypted at rest, decrypted",
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
