// Resolves the app's favicon to the active namespace's glyph. When a
// namespace has picked an icon, that glyph (in the namespace's accent
// colour) stands in for the bundled notes mark as the browser-tab favicon.
// Without a glyph, the bundled `public/favicon.svg` is used unchanged.
// The resolver lives in @niclaslindstedt/oss-framework; this wrapper binds
// it to the app's bundled favicon, its default tint, and the dark badge
// matching `public/favicon.svg`.
import {
  namespaceFaviconHref as frameworkNamespaceFaviconHref,
} from "@niclaslindstedt/oss-framework/namespaces";

import type { Namespace } from "../storage/namespaces.ts";

export { applyFaviconHref } from "@niclaslindstedt/oss-framework/namespaces";

// The bundled mark's ink colour, used to tint a glyph that was given an icon
// but no explicit colour so it still reads as "the app, re-badged".
const DEFAULT_GLYPH_COLOR = "#34d399";

// Background matching the bundled `public/favicon.svg`.
const FAVICON_BG = "#1f2933";

/**
 * The favicon `href` for a namespace: its glyph as a data URI when one is
 * chosen, otherwise the bundled favicon (honouring the deploy slot's base
 * path). A namespace with only a colour (no glyph) keeps the bundled mark.
 */
export function namespaceFaviconHref(ns: Namespace | undefined): string {
  return frameworkNamespaceFaviconHref(
    ns,
    `${import.meta.env.BASE_URL}favicon.svg`,
    { defaultColor: DEFAULT_GLYPH_COLOR, badge: { background: FAVICON_BG } },
  );
}
