// Namespace glyph vocabulary. The path catalogue, the SVG/data-URI badge
// builders, and the name guard live in @niclaslindstedt/oss-framework; this
// module keeps the app's historical import path and pins the app-level
// choices: which glyphs the picker offers (and their order) and the
// favicon badge that matches the bundled `public/favicon.svg`.
import {
  DEFAULT_GLYPH,
  glyphDataUri,
  glyphSvg,
} from "@niclaslindstedt/oss-framework/glyphs";

export {
  GLYPH_PATHS,
  isGlyphName,
} from "@niclaslindstedt/oss-framework/glyphs";

/** Default glyph drawn for a namespace that hasn't picked one. */
export const DEFAULT_NAMESPACE_GLYPH = DEFAULT_GLYPH;

/**
 * The glyphs offered in the namespace icon picker, in display order. Pinned
 * to the set this app has always offered (the framework catalogue carries
 * more); the renderer can still draw any stored name. The default glyph
 * (the folder) is omitted: the picker's leading "default" cell already
 * stands for it.
 */
export const NAMESPACE_GLYPH_NAMES: readonly string[] = [
  "list",
  "home",
  "briefcase",
  "users",
  "heart",
  "star",
  "book",
  "pen",
  "plane",
  "coffee",
  "dumbbell",
  "gift",
  "music",
  "leaf",
  "flag",
  "tag",
  "calendar",
  "pin",
  "bell",
];

// Background matching the bundled `public/favicon.svg` so a namespace
// favicon reads as the same app, just re-badged.
const FAVICON_BG = "#1f2933";

/**
 * Serialise a glyph to a self-contained 64×64 SVG string: the app's dark
 * rounded-square badge with the glyph stroked in `color` and centred.
 */
export function namespaceGlyphSvg(name: string, color: string): string {
  return glyphSvg(name, color, { background: FAVICON_BG });
}

/** A glyph rendered as an `image/svg+xml` data URI, ready for a favicon href. */
export function namespaceGlyphDataUri(name: string, color: string): string {
  return glyphDataUri(name, color, { background: FAVICON_BG });
}
