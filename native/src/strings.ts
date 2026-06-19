// Centralised user-facing copy for the native app. The web app routes its
// strings through `src/i18n/`; the native app has no multi-locale runtime
// (and notes ships English only), but the copy still lives in one place
// rather than inline in each component, so wording stays consistent and a
// future i18n layer has a single surface to wrap.

export const strings = {
  app: {
    title: "notes",
    empty: "No notes yet. Tap + to write your first one.",
    newNote: "New note",
    openMenu: "Open menu",
  },
  editor: {
    back: "Back",
    delete: "Delete",
    deleteNote: "Delete note",
    placeholder: "Start writing…",
  },
  menu: {
    heading: "Menu",
    close: "Close",
    edit: "Edit",
    undo: "Undo",
    redo: "Redo",
    storage: "Storage",
  },
  storage: {
    thisDevice: "This device",
    icloud: "iCloud",
  },
} as const;

// Symbol glyphs the UI draws. Kept beside the copy so a component never holds
// a bare literal; these are font glyphs, not translatable text.
export const glyphs = {
  menu: "☰",
  close: "✕",
  add: "+",
  back: "←",
  undo: "↶",
  redo: "↷",
  radioOn: "◉",
  radioOff: "○",
} as const;
