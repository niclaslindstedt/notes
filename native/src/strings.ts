// Symbol glyphs the native UI draws. User-facing copy now lives in the shared
// i18n `native` namespace (src/i18n/locales/<lang>/native.ts), read through
// the `useT()` hook the web app uses; only these glyphs remain here because
// they are font symbols, not translatable text.

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
