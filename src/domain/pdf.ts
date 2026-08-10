// The PDF renderer's settings model: what a note looks like once it leaves the
// app as a printed page. Pure data + pure validators (no DOM, no I/O), so it
// lives in `domain/` alongside the note model and is trivially testable.
//
// It lives here rather than in `src/theme/themes.ts` for the same reason
// `CopyScope` and `NoteSortKey` do: the pure renderer (`pdf-render.ts`) reads
// it, and `domain/` may not import from the theme layer. `themes.ts`
// re-exports the whole surface, so the appearance store and the settings UI
// keep reading it from where every other preference lives.
//
// The **only** consumer of these values is the print stylesheet the renderer
// emits — the app's own screen theme is deliberately not involved. A note
// exported to PDF should look like a document, not like a screenshot of a dark
// editor, so the page is black-on-white regardless of the active theme and the
// fonts are the ones a print engine can be relied on to have (the app's
// bundled webfonts aren't loaded in the print document).

/** Paper the page is laid out for. */
export type PdfPageSize = "a4" | "letter" | "legal";

export const PDF_PAGE_SIZES: readonly {
  id: PdfPageSize;
  /** The CSS `@page size` keyword. */
  css: string;
}[] = [
  { id: "a4", css: "A4" },
  { id: "letter", css: "Letter" },
  { id: "legal", css: "Legal" },
];

export type PdfOrientation = "portrait" | "landscape";

export const PDF_ORIENTATIONS: readonly PdfOrientation[] = [
  "portrait",
  "landscape",
];

/**
 * Page margins, in millimetres, on all four sides. The three offered values
 * are the ones word processors ship: 12.7mm is Word's "Narrow", 25.4mm its
 * "Normal" one-inch, and 20mm the metric middle most European templates use.
 */
export const PDF_MARGINS_MM: readonly number[] = [12.7, 20, 25.4];

/** The body typeface. Generic families only — see the note at the top. */
export type PdfBodyFont = "sans" | "serif" | "mono";

export const PDF_BODY_FONTS: readonly {
  id: PdfBodyFont;
  /** Full CSS `font-family` value for the print document. */
  stack: string;
}[] = [
  {
    id: "sans",
    stack:
      '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", "Segoe UI", sans-serif',
  },
  {
    id: "serif",
    stack:
      'Georgia, "Times New Roman", Times, "Liberation Serif", "Nimbus Roman", serif',
  },
  {
    id: "mono",
    stack:
      'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  },
];

/** Body text size in points — the unit a print dialog thinks in. */
export const PDF_FONT_SIZES_PT: readonly number[] = [9, 10, 11, 12, 14];

/** Body leading, as a unitless multiple of the font size. */
export const PDF_LINE_HEIGHTS: readonly number[] = [1.2, 1.4, 1.5, 1.6, 1.8];

/**
 * How much bigger than the body text the headings run. Every level is derived
 * from one multiplier so the six levels keep their relative rhythm: `h1` is
 * `1 + 1.1 × scale` times the body size, down to `h6` at body size.
 */
export const PDF_HEADING_SCALES: readonly number[] = [0.6, 0.8, 1, 1.3];

/**
 * The monospaced family code blocks and inline code are set in. Kept separate
 * from the body font (and offered even when the body is already monospaced) —
 * code is the one thing in a note that must not be proportional.
 */
export type PdfCodeFont = "system" | "courier" | "consolas" | "dejavu";

export const PDF_CODE_FONTS: readonly {
  id: PdfCodeFont;
  stack: string;
}[] = [
  {
    id: "system",
    stack: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  },
  { id: "courier", stack: '"Courier New", Courier, monospace' },
  {
    id: "consolas",
    stack: 'Consolas, "Lucida Console", Monaco, monospace',
  },
  {
    id: "dejavu",
    stack: '"DejaVu Sans Mono", "Liberation Mono", monospace',
  },
];

/** Code size relative to the body size — monospaced faces read large at parity. */
export const PDF_CODE_SCALES: readonly number[] = [0.8, 0.85, 0.9, 1];

/** The "no fill behind code" choice, distinct from a chosen colour. */
export const PDF_CODE_BACKGROUND_NONE = "transparent";

/**
 * The swatches the settings picker offers behind code blocks and inline code,
 * plus `transparent` for none. Any `#rrggbb` value validates, so the picker can
 * also offer a free colour input — these are just the presets.
 */
export const PDF_CODE_BACKGROUNDS: readonly string[] = [
  PDF_CODE_BACKGROUND_NONE,
  "#f4f4f5",
  "#eef2f7",
  "#f5f0e6",
  "#e8e8e8",
];

/**
 * The bullet a top-level unordered item wears. Deeper levels rotate onward
 * through this same list (see `bulletGlyphAt`), so picking `dash` gives
 * `– ▪ ‣ • ◦` down the nesting, and every choice still distinguishes its
 * levels.
 */
export type PdfBullet = "disc" | "circle" | "square" | "dash" | "arrow";

export const PDF_BULLETS: readonly { id: PdfBullet; glyph: string }[] = [
  { id: "disc", glyph: "•" },
  { id: "circle", glyph: "◦" },
  { id: "square", glyph: "▪" },
  { id: "dash", glyph: "–" },
  { id: "arrow", glyph: "‣" },
];

/**
 * The bullet character for an unordered item at nesting `depth`, starting from
 * the user's chosen glyph and rotating through `PDF_BULLETS` — the print-side
 * counterpart of the editor's own depth-rotating `BULLET_GLYPHS`.
 */
export function bulletGlyphAt(bullet: PdfBullet, depth: number): string {
  const start = PDF_BULLETS.findIndex((b) => b.id === bullet);
  const from = start === -1 ? 0 : start;
  const level = Number.isFinite(depth) && depth > 0 ? Math.floor(depth) : 0;
  return PDF_BULLETS[(from + level) % PDF_BULLETS.length]!.glyph;
}

/** The persisted PDF-renderer settings. */
export type PdfSettings = {
  pageSize: PdfPageSize;
  orientation: PdfOrientation;
  /** Margin on all four sides, in millimetres. */
  marginMm: number;
  bodyFont: PdfBodyFont;
  /** Body text size in points. */
  fontSizePt: number;
  /** Unitless line-height multiple. */
  lineHeight: number;
  /** Heading-size multiplier; see `PDF_HEADING_SCALES`. */
  headingScale: number;
  codeFont: PdfCodeFont;
  /** Code size as a fraction of the body size. */
  codeFontScale: number;
  /** `#rrggbb` fill behind code, or `transparent` for none. */
  codeBackground: string;
  bullet: PdfBullet;
  /** Print the note's title as the page's heading. */
  includeTitle: boolean;
};

// Standard document defaults: A4 portrait with 20mm margins, 11pt sans at 1.5
// leading, code one notch smaller in the platform's monospace on a light grey
// fill, and a plain round bullet.
export const DEFAULT_PDF_SETTINGS: PdfSettings = {
  pageSize: "a4",
  orientation: "portrait",
  marginMm: 20,
  bodyFont: "sans",
  fontSizePt: 11,
  lineHeight: 1.5,
  headingScale: 1,
  codeFont: "system",
  codeFontScale: 0.9,
  codeBackground: "#f4f4f5",
  bullet: "disc",
  includeTitle: true,
};

const PAGE_SIZE_IDS = new Set<string>(PDF_PAGE_SIZES.map((p) => p.id));
const BODY_FONT_IDS = new Set<string>(PDF_BODY_FONTS.map((f) => f.id));
const CODE_FONT_IDS = new Set<string>(PDF_CODE_FONTS.map((f) => f.id));
const BULLET_IDS = new Set<string>(PDF_BULLETS.map((b) => b.id));

export function isPdfPageSize(v: unknown): v is PdfPageSize {
  return typeof v === "string" && PAGE_SIZE_IDS.has(v);
}

export function isPdfOrientation(v: unknown): v is PdfOrientation {
  return v === "portrait" || v === "landscape";
}

export function isPdfBodyFont(v: unknown): v is PdfBodyFont {
  return typeof v === "string" && BODY_FONT_IDS.has(v);
}

export function isPdfCodeFont(v: unknown): v is PdfCodeFont {
  return typeof v === "string" && CODE_FONT_IDS.has(v);
}

export function isPdfBullet(v: unknown): v is PdfBullet {
  return typeof v === "string" && BULLET_IDS.has(v);
}

/**
 * Whether a stored code-background value is one the stylesheet may emit: the
 * `transparent` keyword, or a `#rgb` / `#rrggbb` colour. Anything else is
 * refused rather than escaped — the value is interpolated into CSS, so the
 * narrow allowlist is what keeps a hostile `settings.json` from smuggling a
 * declaration into the print document.
 */
export function isPdfCodeBackground(v: unknown): v is string {
  if (typeof v !== "string") return false;
  return v === PDF_CODE_BACKGROUND_NONE || /^#[0-9a-fA-F]{3,8}$/.test(v);
}

function pick(values: readonly number[], v: unknown, fallback: number): number {
  return typeof v === "number" && values.includes(v) ? v : fallback;
}

/**
 * Coerce arbitrary stored JSON into a valid `PdfSettings`, falling back to the
 * defaults slot by slot — the same forward/backward-compatible read the rest of
 * the appearance document gets, so a partial or stale `settings.json` from
 * another device can never crash the boot or poison the stylesheet.
 */
export function coercePdfSettings(raw: unknown): PdfSettings {
  if (typeof raw !== "object" || raw === null) return DEFAULT_PDF_SETTINGS;
  const v = raw as Record<string, unknown>;
  return {
    pageSize: isPdfPageSize(v.pageSize)
      ? v.pageSize
      : DEFAULT_PDF_SETTINGS.pageSize,
    orientation: isPdfOrientation(v.orientation)
      ? v.orientation
      : DEFAULT_PDF_SETTINGS.orientation,
    marginMm: pick(PDF_MARGINS_MM, v.marginMm, DEFAULT_PDF_SETTINGS.marginMm),
    bodyFont: isPdfBodyFont(v.bodyFont)
      ? v.bodyFont
      : DEFAULT_PDF_SETTINGS.bodyFont,
    fontSizePt: pick(
      PDF_FONT_SIZES_PT,
      v.fontSizePt,
      DEFAULT_PDF_SETTINGS.fontSizePt,
    ),
    lineHeight: pick(
      PDF_LINE_HEIGHTS,
      v.lineHeight,
      DEFAULT_PDF_SETTINGS.lineHeight,
    ),
    headingScale: pick(
      PDF_HEADING_SCALES,
      v.headingScale,
      DEFAULT_PDF_SETTINGS.headingScale,
    ),
    codeFont: isPdfCodeFont(v.codeFont)
      ? v.codeFont
      : DEFAULT_PDF_SETTINGS.codeFont,
    codeFontScale: pick(
      PDF_CODE_SCALES,
      v.codeFontScale,
      DEFAULT_PDF_SETTINGS.codeFontScale,
    ),
    codeBackground: isPdfCodeBackground(v.codeBackground)
      ? v.codeBackground
      : DEFAULT_PDF_SETTINGS.codeBackground,
    bullet: isPdfBullet(v.bullet) ? v.bullet : DEFAULT_PDF_SETTINGS.bullet,
    includeTitle:
      typeof v.includeTitle === "boolean"
        ? v.includeTitle
        : DEFAULT_PDF_SETTINGS.includeTitle,
  };
}

/** The CSS `font-family` value for a body-font id. */
export function pdfBodyFontStack(id: PdfBodyFont): string {
  return (
    PDF_BODY_FONTS.find((f) => f.id === id)?.stack ?? PDF_BODY_FONTS[0]!.stack
  );
}

/** The CSS `font-family` value for a code-font id. */
export function pdfCodeFontStack(id: PdfCodeFont): string {
  return (
    PDF_CODE_FONTS.find((f) => f.id === id)?.stack ?? PDF_CODE_FONTS[0]!.stack
  );
}

/** The CSS `@page size` value — paper keyword plus orientation. */
export function pdfPageSizeCss(settings: PdfSettings): string {
  const paper =
    PDF_PAGE_SIZES.find((p) => p.id === settings.pageSize)?.css ??
    PDF_PAGE_SIZES[0]!.css;
  return `${paper} ${settings.orientation}`;
}
