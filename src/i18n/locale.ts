// Helpers around the app's two-letter language code. Kept tiny and
// standalone (no React, no catalog modules) so non-component callers — and
// the React Native app, which shares this module verbatim — can import it
// freely. Ported from checklist's `locale.ts`.

export type Lang = "en" | "sv";

export const SUPPORTED_LANGS: readonly Lang[] = ["en", "sv"];

// Map "en" → "en-GB" and "sv" → "sv-SE" so any future Intl formatter (and
// the `<html lang>` attribute the language root sets) picks a concrete
// locale rather than guessing.
export function bcp47(lang: Lang): string {
  return lang === "sv" ? "sv-SE" : "en-GB";
}

// Consulted only when no preference is stored yet. Anything whose
// `navigator.language` starts with `sv` → Swedish; everything else →
// English. On React Native `navigator.language` is typically undefined, so
// this safely defaults to English there.
export function detectInitialLanguage(): Lang {
  if (typeof navigator === "undefined") return "en";
  const raw = navigator.language ?? "";
  return raw.toLowerCase().startsWith("sv") ? "sv" : "en";
}
