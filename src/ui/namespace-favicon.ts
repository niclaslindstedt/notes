// Resolves the app's favicon to the active namespace's glyph. When a
// namespace has picked an icon, that glyph (in the namespace's accent
// colour) stands in for the bundled notes mark as the browser-tab favicon.
// Without a glyph, the bundled `public/favicon.svg` is used unchanged.

import type { Namespace } from "../storage/namespaces.ts";
import { isGlyphName, namespaceGlyphDataUri } from "./glyphs.ts";

// The bundled mark's ink colour, used to tint a glyph that was given an icon
// but no explicit colour so it still reads as "the app, re-badged".
const DEFAULT_GLYPH_COLOR = "#34d399";

/** The path to the bundled favicon, honouring the deploy slot's base path. */
function bundledFavicon(): string {
  return `${import.meta.env.BASE_URL}favicon.svg`;
}

/**
 * The favicon `href` for a namespace: its glyph as a data URI when one is
 * chosen, otherwise the bundled favicon. A namespace with only a colour (no
 * glyph) keeps the bundled mark — the favicon is replaced only when a glyph
 * is picked.
 */
export function namespaceFaviconHref(ns: Namespace | undefined): string {
  if (ns && isGlyphName(ns.glyph)) {
    return namespaceGlyphDataUri(ns.glyph, ns.color ?? DEFAULT_GLYPH_COLOR);
  }
  return bundledFavicon();
}

/**
 * Point the browser-tab favicon at `href`. Reuses the existing
 * `image/svg+xml` icon link from `index.html`, creating one only if it's
 * somehow absent.
 */
export function applyFaviconHref(href: string): void {
  if (typeof document === "undefined") return;
  let link = document.head.querySelector<HTMLLinkElement>(
    'link[rel="icon"][type="image/svg+xml"]',
  );
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    document.head.appendChild(link);
  }
  link.href = href;
}
