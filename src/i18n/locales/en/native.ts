import type { Widen } from "./_widen.ts";

// Copy for the React Native app (native/). Self-contained — it references no
// other namespace so the native surface stays decoupled from the web copy.
// Mirrors the keys the native UI shows; glyphs (☰ ✕ + ← ↶ ↷ ◉ ○) are font
// symbols, not translatable, and stay in native/src/strings.ts.

const native = {
  title: "Notes",
  empty: "No notes yet. Tap + to write your first one.",
  newNote: "New note",
  openMenu: "Open menu",
  back: "Back",
  delete: "Delete",
  deleteNote: "Delete note",
  placeholder: "Start writing…",
  menu: {
    heading: "Menu",
    close: "Close",
    edit: "Edit",
    undo: "Undo",
    redo: "Redo",
    storage: "Storage",
    language: "Language",
  },
  storage: {
    thisDevice: "This device",
    icloud: "iCloud",
  },
} as const;

export type NativeCatalog = Widen<typeof native>;

export default native;
