// Glyphs for the styling toolbar (`FormatToolbar.tsx`). The app inlines its
// icons rather than pulling an icon dependency (see `icons.tsx`), and the
// toolbar needs a glyph per Markdown construct that the shared set doesn't
// carry — bold, italic, strikethrough, the two list kinds, indent / outdent,
// the quote and rule marks. Kept in their own module so adding a toolbar
// button touches only this file and `FormatToolbar.tsx`.
//
// Every glyph is a 24×24 stroked icon painting with `currentColor`, matching
// the frame `icons.tsx` uses, so a toolbar button and a header button look
// like they came from the same set.

import type { ReactNode } from "react";

type IconProps = { className?: string };

// Shared frame so each glyph below is only its paths.
function Svg({ className, children }: IconProps & { children: ReactNode }) {
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
    >
      {children}
    </svg>
  );
}

/**
 * The toolbar's own toggle, in the editor header: a serif "T", the universal
 * shorthand for "text formatting".
 */
export function FormatIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 7V4h16v3" />
      <path d="M12 4v16" />
      <path d="M9 20h6" />
    </Svg>
  );
}

/**
 * A heading level, drawn as letters rather than an SVG: an "H" with the level
 * as a subscript numeral. Six near-identical stroked glyphs would be unreadable
 * at 18px, whereas `H1 … H6` says exactly which level a button applies.
 */
export function HeadingGlyph({
  level,
  className,
}: IconProps & { level: number }) {
  return (
    <span
      aria-hidden
      className={`inline-flex items-baseline font-semibold tracking-tight ${className ?? ""}`}
    >
      <span className="text-[0.95em] leading-none">H</span>
      <span className="text-[0.68em] leading-none">{level}</span>
    </span>
  );
}

export function BoldGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" />
    </Svg>
  );
}

export function ItalicGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M19 4h-9" />
      <path d="M14 20H5" />
      <path d="m15 4-6 16" />
    </Svg>
  );
}

export function StrikethroughGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M16 4H9a3 3 0 0 0-2.83 4" />
      <path d="M14 12a4 4 0 0 1 0 8H6" />
      <path d="M4 12h16" />
    </Svg>
  );
}

/** `` `inline code` `` — the angle brackets, matching the app's CodeIcon. */
export function InlineCodeGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m16 18 6-6-6-6" />
      <path d="m8 6-6 6 6 6" />
    </Svg>
  );
}

/** A ``` fenced block — the same brackets, boxed. */
export function CodeBlockGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M10 9.5 8 12l2 2.5" />
      <path d="m14 9.5 2 2.5-2 2.5" />
    </Svg>
  );
}

export function BulletListGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </Svg>
  );
}

export function OrderedListGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M10 6h11M10 12h11M10 18h11" />
      <path d="M4 6h1v4" />
      <path d="M4 10h2" />
      <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
    </Svg>
  );
}

export function QuoteGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M17 6H3" />
      <path d="M21 12H8" />
      <path d="M21 18H8" />
      <path d="M3 12v6" />
    </Svg>
  );
}

export function IndentGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m3 8 4 4-4 4" />
      <path d="M21 6H11M21 12H11M21 18H11" />
    </Svg>
  );
}

export function OutdentGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m7 8-4 4 4 4" />
      <path d="M21 6H11M21 12H11M21 18H11" />
    </Svg>
  );
}

export function LinkGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Svg>
  );
}

export function ImageGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="1.6" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </Svg>
  );
}

/** A `---` rule: the divider itself, between two faded lines of text. */
export function RuleGlyph({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 12h18" />
      <path d="M6 6h12M6 18h12" strokeOpacity="0.4" />
    </Svg>
  );
}
