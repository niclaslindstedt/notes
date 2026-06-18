// Glyph catalogue for namespaces. A namespace can carry an icon the user
// picks here (see `Namespace.glyph` in `src/storage/namespaces.ts`); the
// picked glyph tints its row in the side menu and replaces the app favicon
// while that namespace is active.
//
// notes inlines the handful of glyphs it needs rather than add an icon
// dependency (the same call `icons.tsx` makes). Each glyph is stored as the
// *inner* SVG markup of a 24×24 lucide-style outline — no wrapper `<svg>`,
// no stroke/fill on the paths themselves — so one source feeds both the
// React component (`NamespaceGlyph`, which wraps it in a styled `<svg>`) and
// the favicon builder (`namespaceGlyphDataUri`, which serialises it to a data
// URI). The wrapper supplies `fill="none" stroke="currentColor"`, so a path
// opts into a fill only by setting it explicitly (the tag's pin-hole dot
// below).

// name → inner SVG markup (paths on a 0 0 24 24 grid, lucide weight).
export const GLYPH_PATHS: Record<string, string> = {
  list: '<path d="m3 6 1.5 1.5L7 5"/><path d="M11 6h10"/><path d="M11 12h10"/><path d="M11 18h10"/><path d="M3.5 12h.01"/><path d="M3.5 18h.01"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  briefcase:
    '<rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  heart:
    '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.5 4.04 3 5.5l7 7Z"/>',
  star: '<path d="M12 2.5 14.95 8.6 21.5 9.55l-4.75 4.6L17.9 20.7 12 17.6 6.1 20.7l1.15-6.55L2.5 9.55 9.05 8.6z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  plane:
    '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  coffee:
    '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M6 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/>',
  dumbbell:
    '<path d="m6.5 6.5 11 11"/><path d="m21 21-1-1"/><path d="m3 3 1 1"/><path d="m18 22 4-4"/><path d="m2 6 4-4"/><path d="m3 10 7-7"/><path d="m14 21 7-7"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C9 3 12 8 12 8s3-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  music:
    '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  folder:
    '<path d="M4 5h5l2 2.5h9a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
  calendar:
    '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 2v4"/><path d="M16 2v4"/>',
  pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
};

/** Default glyph drawn for a namespace that hasn't picked one. */
export const DEFAULT_NAMESPACE_GLYPH = "folder";

/**
 * The glyphs offered in the namespace icon picker, in display order.
 * Derived from `GLYPH_PATHS` so the picker can never offer a name the
 * renderer can't draw. The default glyph (the folder) is omitted: the
 * picker's leading "default" cell already stands for it, so listing it
 * again would be a duplicate.
 */
export const NAMESPACE_GLYPH_NAMES: readonly string[] = Object.keys(
  GLYPH_PATHS,
).filter((name) => name !== DEFAULT_NAMESPACE_GLYPH);

/** Whether a string names a glyph this build knows how to draw. */
export function isGlyphName(name: string | undefined): name is string {
  return name !== undefined && name in GLYPH_PATHS;
}

// Background matching the bundled `public/favicon.svg` so a namespace
// favicon reads as the same app, just re-badged.
const FAVICON_BG = "#1f2933";

/**
 * Serialise a glyph to a self-contained 64×64 SVG string: the app's dark
 * rounded-square badge with the glyph stroked in `color` and centred. Used
 * to build the favicon data URI; falls back to the default glyph for an
 * unknown name so a stale stored value never yields an empty icon.
 */
export function namespaceGlyphSvg(name: string, color: string): string {
  const inner = GLYPH_PATHS[name] ?? GLYPH_PATHS[DEFAULT_NAMESPACE_GLYPH]!;
  // The glyph is authored on a 24-unit grid; scale it to a 40px box and
  // centre it in the 64px badge (offset (64−40)/2 = 12).
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="12" fill="${FAVICON_BG}"/>` +
    `<g transform="translate(12 12) scale(1.6667)" fill="none" stroke="${color}" color="${color}" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</g>` +
    `</svg>`
  );
}

/** A glyph rendered as an `image/svg+xml` data URI, ready for a favicon href. */
export function namespaceGlyphDataUri(name: string, color: string): string {
  return `data:image/svg+xml,${encodeURIComponent(namespaceGlyphSvg(name, color))}`;
}
