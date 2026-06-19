import type { Widen } from "./_widen.ts";

// Strings for the left navigation drawer — the floating toggle button, the
// section headers (Namespaces / Notes / Edit), the note switcher (each note
// by title, plus "new note" and the per-row delete), the namespace manage
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
  notesEmpty: "No notes yet.",
  deleteNote: "Delete note",
  confirmDelete: "Confirm delete",
  edit: "Edit",
  undo: "Undo",
  redo: "Redo",
} as const;

export type NavCatalog = Widen<typeof nav>;

export default nav;
