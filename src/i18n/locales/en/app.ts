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
  // Label of one line-number press target in the editor's gutter (line numbers
  // are opt-in); pressing it selects that whole line.
  selectLine: "Select line {n}",
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
  // The "Copied" confirmation, shared by the export menu's clipboard row, the
  // copy button on a fenced code block, and the editor's selection actions.
  // What the note row copies is the copy-scope editor setting; see
  // settings.editor.copy*. `selection` labels the copy button that joins the
  // narrow editor header while text is selected — it takes the highlighted
  // text and nothing else.
  copy: {
    copied: "Copied",
    selection: "Copy selection",
  },
  // The export button (the up arrow) in the note header and the three rows of
  // its menu. On a narrow screen the rows show only their glyph, so each label
  // is also the row's tooltip and accessible name.
  export: {
    label: "Export",
    pdf: "Export to PDF",
    markdown: "Export to MD",
    clipboard: "Copy to clipboard",
    // The connector in a PDF's "1 of 7" footer. It lives here rather than in
    // the settings catalogue because it is *printed content*, not a label —
    // the export hands it to the pure typesetter, which holds no catalogue.
    pageNumberOf: "of",
    // The failure toast the PDF/MD rows raise when the export couldn't
    // produce a file. The export code is fetched on the press, so the usual
    // cause is a page outlived by a deploy asking for a chunk the server no
    // longer has — which is why the toast's action is a reload: a fresh page
    // references the chunks that actually exist.
    failed: "Export failed",
    reload: "Reload",
  },
  // The copy button in a fenced code block's top-right corner. It confirms
  // with the same "Copied" as the export menu's clipboard row above.
  copyCode: "Copy code",
  // Right-click menu entry on a note row: puts the note's own link on the
  // clipboard, so it can be bookmarked or sent to yourself.
  copyLink: "Copy link",
  // A `- [ ] ` / `- [x] ` list row renders as a real checkbox. `toggle` names
  // the press target in the editor (pressing it ticks the item off in the
  // Markdown itself); `todo` / `done` name the same box where it is only
  // showing state, on the read-only archived-note view.
  task: {
    toggle: "Toggle task",
    todo: "Not done",
    done: "Done",
  },
  // The editor's cut button (left of the export button, and only on a touch
  // pointer) and its Ctrl/Cmd+K shortcut: the selection, or the rest of the
  // line from a mid-line caret, or the whole line — onto the clipboard on its
  // way out.
  cut: "Cut",
  // The dropzone: a temporary note for handing text to your other devices.
  // `newNote` labels the long press on a "new note" button that makes one;
  // `done` is the floating checkmark in its editor, which DELETES the note (it
  // is never archived — there is nothing to keep). The `keep*` strings are the
  // prompt raised when a dropzone note is given a name of its own, which is the
  // gesture that says it turned out to be worth keeping.
  dropzone: {
    newNote: "New dropzone note",
    // Tooltip on the "new note" buttons wherever the hold is offered — the
    // only visible hint that the gesture exists, so it names the gesture
    // rather than the note.
    hold: "Hold for a dropzone note",
    done: "Done — delete this note",
    // The toast confirming that press — the checkmark deletes the note and
    // leaves the editor in one go, so this is the only trace of what happened.
    // Its Undo button reuses `nav.undo`.
    deleted: "Dropzone note deleted",
    keepTitle: "Save as a regular note?",
    keepBody:
      "“{title}” is a dropzone note, meant to be picked up on another device and ticked off. Naming it usually means you want to keep it — save it and it moves into your notes; leave it and it stays in the Dropzone.",
    keep: "Save note",
    discard: "Keep in Dropzone",
  },
  // The editor header's leading star button, which lifts the open note into
  // (and out of) the side menu's Favorites section. The label states what the
  // press will do, so it flips with the note's current state.
  favorite: "Add to favorites",
  unfavorite: "Remove from favorites",
  // The editor header's eye button, beside the star: it makes the open note
  // read-only (no caret, no keyboard, no edits) and unlocks it again. Like the
  // star's, the label states what the press will do, so it flips with the
  // note's current state.
  lock: "Lock note",
  unlock: "Unlock note",
  // The ⋯ toggle a narrow editor header folds its whole action cluster into.
  // The label states what the press will do, so it flips with the row's state.
  actions: {
    show: "Note actions",
    hide: "Hide note actions",
  },
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
    checklist: "Checklist",
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
    // The regex switch, wearing `.*` as its face. Its label is what it does
    // to the search field, not what the characters spell.
    regex: "Use a regular expression",
    // Shown in the match counter's place, which shares its row with the field
    // — hence one word rather than the sentence, which is the hover title.
    invalid: "Invalid",
    invalidPattern: "That isn’t a valid regular expression",
    // The search field's magnifier doubles as the disclosure for the second
    // row. Its label says what the press will do, so it flips with the state.
    replaceRow: "Show replace",
    hideReplace: "Hide replace",
    replaceField: "Replace with",
    replacePlaceholder: "Replace with…",
    replace: "Replace this match",
    replaceAll: "Replace all matches",
    // The preview panel: it writes nothing, so its copy is about what *would*
    // happen rather than what has.
    preview: "Preview the replacement",
    previewPanel: "Replacement preview",
    previewSummary: "Preview: {matches} matches on {lines} lines",
    previewSummaryOneLine: "Preview: {matches} matches on 1 line",
    previewSummaryOne: "Preview: 1 match on 1 line",
    previewMore: "{count} more lines",
    previewMoreOne: "1 more line",
  },
  // The inline YouTube player a bare YouTube link renders as: the press that
  // starts the video, and the widescreen button that lifts the player out of
  // the note over a blurred backdrop (and puts it back).
  youtube: {
    player: "YouTube video",
    play: "Play video",
    widescreen: "Widescreen",
    exitWidescreen: "Exit widescreen",
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
  // The last-resort screen shown when a render throws, in place of the blank
  // page the app would otherwise be left as (see `ErrorBoundary`). Notes are
  // already on disk at this point — nothing is lost by reloading.
  crash: {
    title: "Something went wrong",
    body: "The app hit an unexpected error. Your notes are saved — reloading should pick up where you left off.",
    reload: "Reload the app",
    details: "Error details",
    // The crash screen's copy button. It puts the error, the component stack,
    // and the tail of the in-app log on the clipboard — the only way to get a
    // phone-only crash off the device, since Settings → Logs is inside the app
    // this screen has replaced.
    copy: "Copy report",
    copied: "Copied",
    copyFailed: "Copy failed",
  },
} as const;

export type AppCatalog = Widen<typeof app>;

export default app;
