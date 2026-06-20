import type { Widen } from "./_widen.ts";

// Strings for the left navigation drawer — the floating toggle button, the
// section headers (Namespaces / Notes), the note switcher (each note by
// title, plus "new note" and the per-row delete), the namespace manage
// action, and the undo / redo edit actions.

const nav = {
  open: "Open menu",
  close: "Close menu",
  label: "Navigation",
  chooseSection: "Choose section",
  namespaces: "Namespaces",
  manageNamespaces: "Manage namespaces",
  notes: "Notes",
  newNote: "New note",
  newFolder: "New folder",
  folderName: "Folder name",
  renameFolder: "Rename folder",
  deleteFolder: "Delete folder",
  moveToFolder: "Move to folder",
  noFolder: "No folder",
  showAll: "Show all",
  notesEmpty: "No notes yet.",
  folderEmpty: "Empty folder",
  deleteNote: "Delete note",
  undo: "Undo",
  redo: "Redo",
  // The archive entry at the foot of the notes list and the page it opens.
  archive: "Archive",
  archiveHeading: "Archive",
  archiveEmpty: "Nothing archived. Swipe a note right to file it here.",
  restore: "Restore",
} as const;

export type NavCatalog = Widen<typeof nav>;

export default nav;
