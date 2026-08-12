// The PDF renderer's settings model: what a note looks like once it leaves the
// app as a printed page. Pure data + pure validators (no DOM, no I/O), so it
// lives in `domain/` alongside the note model and is trivially testable.
//
// It lives here rather than in `src/theme/themes.ts` for the same reason
// `CopyScope` and `NoteSortKey` do: the pure layout engine (`pdf-layout.ts`)
// reads it, and `domain/` may not import from the theme layer. `themes.ts`
// re-exports the whole surface, so the appearance store and the settings UI
// keep reading it from where every other preference lives.
//
// The **only** consumer of these values is the PDF the export writes — the
// app's own screen theme is deliberately not involved. A note exported to PDF
// should look like a document, not like a screenshot of a dark editor, so the
// page is black-on-white regardless of the active theme.
//
// The font choices are the **PDF standard fonts** (Helvetica, Times, Courier):
// every reader has them, so they cost the file nothing, and they are what a
// document is expected to look like. Their price is that they only encode
// Latin-1 — see `src/assets/fonts/README.md` for the fallback that covers the
// rest, and `DejaVuSansMono` below for the one place a font is embedded by
// choice rather than by necessity.

/** Paper the page is laid out for. */
export type PdfPageSize = "a4" | "letter" | "legal";

export const PDF_PAGE_SIZES: readonly {
  id: PdfPageSize;
  /** Portrait paper size in PostScript points, the unit the PDF is written in. */
  widthPt: number;
  heightPt: number;
}[] = [
  { id: "a4", widthPt: 595.28, heightPt: 841.89 },
  { id: "letter", widthPt: 612, heightPt: 792 },
  { id: "legal", widthPt: 612, heightPt: 1008 },
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

/**
 * A typeface the PDF writer can actually set text in. The first three are
 * standard fonts the reader supplies; `dejavuMono` is embedded from
 * `src/assets/fonts/`, and `fallback` is the Unicode stand-in the writer
 * substitutes per-run for characters the standard fonts can't encode — never
 * something the user picks.
 */
export type PdfFontFamily =
  "helvetica" | "times" | "courier" | "dejavuMono" | "fallback";

/** The body typeface. Generic families only — see the note at the top. */
export type PdfBodyFont = "sans" | "serif" | "mono";

export const PDF_BODY_FONTS: readonly {
  id: PdfBodyFont;
  family: PdfFontFamily;
}[] = [
  { id: "sans", family: "helvetica" },
  { id: "serif", family: "times" },
  { id: "mono", family: "courier" },
];

/**
 * The heading typeface. `body` — the default — is not a font but a deferral:
 * headings follow whatever the body is set in, which is what a document does
 * unless someone deliberately mixes families (a serif body under sans headings
 * being the classic pairing).
 */
export type PdfHeadingFont = "body" | PdfBodyFont;

export const PDF_HEADING_FONTS: readonly PdfHeadingFont[] = [
  "body",
  "sans",
  "serif",
  "mono",
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
 *
 * Two entries, because two is how many a self-contained PDF can honestly
 * offer: Courier is a standard font every reader already has, and DejaVu Sans
 * Mono is embedded from `src/assets/fonts/` for anyone who finds Courier too
 * thin. Naming a family the file doesn't carry — Consolas, SF Mono — would
 * just be a request the reader substitutes its way out of.
 */
export type PdfCodeFont = "courier" | "dejavu";

export const PDF_CODE_FONTS: readonly {
  id: PdfCodeFont;
  family: PdfFontFamily;
  /** Whether choosing it makes the export fetch (and embed) a font file. */
  embedded: boolean;
}[] = [
  { id: "courier", family: "courier", embedded: false },
  { id: "dejavu", family: "dejavuMono", embedded: true },
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
 * through this same list (see `bulletAt`), so picking `dash` gives
 * `– ▪ ‣ • ◦` down the nesting, and every choice still distinguishes its
 * levels.
 *
 * The PDF **draws** these rather than setting them as text: a filled circle is
 * two curves the writer already knows how to emit, where the glyph `•` is a
 * character the standard fonts happen to carry and `‣` is one they don't. The
 * `glyph` below is only how the settings picker labels the choice on screen.
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
 * The bullet for an unordered item at nesting `depth`, starting from the user's
 * chosen one and rotating through `PDF_BULLETS` — the paper-side counterpart of
 * the editor's own depth-rotating `BULLET_GLYPHS`.
 */
export function bulletAt(bullet: PdfBullet, depth: number): PdfBullet {
  const start = PDF_BULLETS.findIndex((b) => b.id === bullet);
  const from = start === -1 ? 0 : start;
  const level = Number.isFinite(depth) && depth > 0 ? Math.floor(depth) : 0;
  return PDF_BULLETS[(from + level) % PDF_BULLETS.length]!.id;
}

/**
 * How the footer writes a page number. `ofTotal` spells the connector out
 * (`1 of 7`), `slash` is the terse form (`1 / 7`), and `plain` prints the page
 * on its own — which is what you want when the reader never needs to know the
 * document is finished, or when the pages are going into a binder with other
 * things.
 */
export type PdfPageNumberFormat = "ofTotal" | "slash" | "plain";

export const PDF_PAGE_NUMBER_FORMATS: readonly PdfPageNumberFormat[] = [
  "ofTotal",
  "slash",
  "plain",
];

/** Which margin edge the page number sits against. */
export type PdfPageNumberAlign = "left" | "center" | "right";

export const PDF_PAGE_NUMBER_ALIGNS: readonly PdfPageNumberAlign[] = [
  "left",
  "center",
  "right",
];

/**
 * The English connector in the `ofTotal` form. The typesetter is pure and has
 * no business reaching into the i18n runtime, so the translated word is passed
 * *in* (`PdfLayoutInput.pageNumberOf`) by the export handler, which has a `t`;
 * this is the fallback for every caller that doesn't — the tests, and any
 * future headless writer.
 */
export const PDF_PAGE_NUMBER_OF = "of";

/**
 * The text of the footer on page `page` of `total`. Pure, and shared with the
 * settings picker so the option labels are literally what the PDF will print
 * rather than a hand-written approximation of it.
 */
export function pdfPageNumberText(
  format: PdfPageNumberFormat,
  page: number,
  total: number,
  ofWord: string = PDF_PAGE_NUMBER_OF,
): string {
  if (format === "plain") return `${page}`;
  if (format === "ofTotal") return `${page} ${ofWord} ${total}`;
  return `${page} / ${total}`;
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
  /** Heading typeface, or `body` to follow the body font. */
  headingFont: PdfHeadingFont;
  codeFont: PdfCodeFont;
  /** Code size as a fraction of the body size. */
  codeFontScale: number;
  /** `#rrggbb` fill behind code, or `transparent` for none. */
  codeBackground: string;
  bullet: PdfBullet;
  /** Print the note's title as the page's heading. */
  includeTitle: boolean;
  /** Foot each page with its number. */
  pageNumbers: boolean;
  /** How that number is written — see `pdfPageNumberText`. */
  pageNumberFormat: PdfPageNumberFormat;
  /** Which margin edge it sits against. */
  pageNumberAlign: PdfPageNumberAlign;
};

// Standard document defaults: A4 portrait with 20mm margins, 11pt sans at 1.5
// leading, headings following the body font, code one notch smaller in Courier
// on a light grey fill, a plain round bullet, and pages numbered `1 / 7` in the
// middle of the bottom margin — the form the export has always written, so the
// two new choices default to what an existing document already looks like.
export const DEFAULT_PDF_SETTINGS: PdfSettings = {
  pageSize: "a4",
  orientation: "portrait",
  marginMm: 20,
  bodyFont: "sans",
  fontSizePt: 11,
  lineHeight: 1.5,
  headingScale: 1,
  headingFont: "body",
  codeFont: "courier",
  codeFontScale: 0.9,
  codeBackground: "#f4f4f5",
  bullet: "disc",
  includeTitle: true,
  pageNumbers: true,
  pageNumberFormat: "slash",
  pageNumberAlign: "center",
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

export function isPdfHeadingFont(v: unknown): v is PdfHeadingFont {
  return v === "body" || isPdfBodyFont(v);
}

export function isPdfCodeFont(v: unknown): v is PdfCodeFont {
  return typeof v === "string" && CODE_FONT_IDS.has(v);
}

export function isPdfBullet(v: unknown): v is PdfBullet {
  return typeof v === "string" && BULLET_IDS.has(v);
}

export function isPdfPageNumberFormat(v: unknown): v is PdfPageNumberFormat {
  return (
    typeof v === "string" &&
    (PDF_PAGE_NUMBER_FORMATS as readonly string[]).includes(v)
  );
}

export function isPdfPageNumberAlign(v: unknown): v is PdfPageNumberAlign {
  return (
    typeof v === "string" &&
    (PDF_PAGE_NUMBER_ALIGNS as readonly string[]).includes(v)
  );
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
    headingFont: isPdfHeadingFont(v.headingFont)
      ? v.headingFont
      : DEFAULT_PDF_SETTINGS.headingFont,
    // A document written before the export embedded its own fonts may name a
    // family only a browser could resolve (`system`, `consolas`); those land on
    // the default the same way any other unknown value does.
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
    pageNumbers:
      typeof v.pageNumbers === "boolean"
        ? v.pageNumbers
        : DEFAULT_PDF_SETTINGS.pageNumbers,
    // Absent in a document written before the footer was configurable, which
    // lands it on the `1 / 7` centred form that build already wrote.
    pageNumberFormat: isPdfPageNumberFormat(v.pageNumberFormat)
      ? v.pageNumberFormat
      : DEFAULT_PDF_SETTINGS.pageNumberFormat,
    pageNumberAlign: isPdfPageNumberAlign(v.pageNumberAlign)
      ? v.pageNumberAlign
      : DEFAULT_PDF_SETTINGS.pageNumberAlign,
  };
}

/** The typeface a body-font id resolves to. */
export function pdfBodyFamily(id: PdfBodyFont): PdfFontFamily {
  return (
    PDF_BODY_FONTS.find((f) => f.id === id)?.family ?? PDF_BODY_FONTS[0]!.family
  );
}

/** The typeface headings are set in, resolving `body` against the body font. */
export function pdfHeadingFamily(settings: PdfSettings): PdfFontFamily {
  return pdfBodyFamily(
    settings.headingFont === "body" ? settings.bodyFont : settings.headingFont,
  );
}

/** The typeface a code-font id resolves to. */
export function pdfCodeFamily(id: PdfCodeFont): PdfFontFamily {
  return (
    PDF_CODE_FONTS.find((f) => f.id === id)?.family ?? PDF_CODE_FONTS[0]!.family
  );
}

/** The page box in points, with orientation applied. */
export function pdfPageSizePt(settings: PdfSettings): {
  widthPt: number;
  heightPt: number;
} {
  const paper =
    PDF_PAGE_SIZES.find((p) => p.id === settings.pageSize) ??
    PDF_PAGE_SIZES[0]!;
  return settings.orientation === "landscape"
    ? { widthPt: paper.heightPt, heightPt: paper.widthPt }
    : { widthPt: paper.widthPt, heightPt: paper.heightPt };
}

/** Millimetres to points, the unit everything below the settings works in. */
export function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}
