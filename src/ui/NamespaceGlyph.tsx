import type { CSSProperties } from "react";

import { DEFAULT_NAMESPACE_GLYPH, GLYPH_PATHS } from "./glyphs.ts";

// Renders one namespace glyph as an inline SVG. The path data lives in
// `glyphs.ts` as bare markup (so the same source can also build the
// favicon data URI); here we wrap it in a lucide-weight `<svg>` that paints
// with `currentColor`, so callers tint it through a Tailwind text class or
// an inline `color` style. An unknown / missing name falls back to the
// default folder glyph rather than rendering nothing.

type Props = {
  /** Glyph name from `GLYPH_PATHS`; falls back to the default when unknown. */
  name?: string;
  className?: string;
  /** Inline style — used to tint the glyph with a namespace's accent colour. */
  style?: CSSProperties;
};

export function NamespaceGlyph({ name, className, style }: Props) {
  const inner =
    (name && GLYPH_PATHS[name]) ?? GLYPH_PATHS[DEFAULT_NAMESPACE_GLYPH]!;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}
