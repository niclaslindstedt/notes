// On-demand webfont loaders — re-exported from the framework's theme module.
//
// The loaders, their per-session memoisation, and the latin / latin-ext subset
// choices used to be a local clone here; they now live in
// `@niclaslindstedt/oss-framework/theme` (which dynamically imports the
// `@fontsource/*` CSS for the non-default families). This shim keeps the
// `theme/fonts.ts` import path stable for the Appearance picker
// (`loadAllFontFamilies`, to warm the previews) and the projection engine
// (`loadFontFamily`).
//
// The default `mono` family (JetBrains Mono) stays statically imported by
// `src/app/main.tsx`, so it's part of the main bundle and precached for
// offline first paint — the framework treats it as a no-op in `loadFontFamily`.

export {
  loadFontFamily,
  loadAllFontFamilies,
} from "@niclaslindstedt/oss-framework/theme";
