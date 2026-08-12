// Lays a note out on paper: a note in, a list of pages of drawing operations
// out. This is the typesetter — where every decision about *where a thing goes*
// is made. What turns those operations into an actual PDF file is
// `src/ui/export/pdf-document.ts`, which knows about jsPDF and nothing about
// notes.
//
// **Why the app paginates its own document.** The export used to build an HTML
// page and hand it to `window.print()`, letting the browser's engine write the
// PDF. That works, but the page furniture belongs to the browser: the URL, the
// date and the page number are stamped into the margins by the print dialog,
// the file arrives through a dialog rather than as a download, and CSS gives no
// way to turn any of it off. Owning the layout is what buys the plain document
// and the direct download — and, incidentally, exact control over the page
// number the user *does* ask for.
//
// Pure: no DOM, no I/O, no jsPDF. Two things it can't know are injected:
//
//   * **`measure`** — how wide a string is in a given font at a given size.
//     Text metrics belong to the writer, and the writer must agree with the
//     typesetter exactly or lines wrap in the wrong place. See `TextMeasurer`
//     for the contract, which includes the Unicode fallback.
//   * **`resolveImage`** — an image reference's pixel dimensions, so a picture
//     can be scaled to the column before its bytes are anywhere near here.
//
// Coordinates are **points, from the top-left of the page**, which is what
// jsPDF works in. A `text` op's `y` is its baseline; every other op's `y` is
// the top edge.

import {
  classifyLines,
  parseInline,
  type InlineNode,
  type LineBlock,
} from "./markdown.ts";
import {
  bulletAt,
  mmToPt,
  pdfBodyFamily,
  pdfCodeFamily,
  pdfHeadingFamily,
  pdfPageSizePt,
  PDF_CODE_BACKGROUND_NONE,
  type PdfBullet,
  type PdfFontFamily,
  type PdfSettings,
} from "./pdf.ts";
import { applyTransforms, type CompiledTransform } from "./transform.ts";

// ---------------------------------------------------------------------------
// The contract with the writer
// ---------------------------------------------------------------------------

/** One concrete typeface + weight + slant, as the writer must set it. */
export type PdfFontStyle = {
  family: PdfFontFamily;
  bold: boolean;
  italic: boolean;
};

/**
 * How wide `text` is, in points, set in `font` at `sizePt`.
 *
 * **It must measure the string as the writer will actually draw it** — the
 * fallback included. A character the chosen family can't encode is drawn in the
 * Unicode fallback font, which is a different width, and a measurer that
 * ignored that would wrap Cyrillic lines in the wrong place. Keeping the
 * substitution on the writer's side of this seam is what lets the typesetter
 * stay ignorant of which fonts exist.
 */
export type TextMeasurer = (
  text: string,
  font: PdfFontStyle,
  sizePt: number,
) => number;

/** An image the writer holds the bytes for, sized so the layout can place it. */
export type PdfImage = {
  /** The writer's handle for the bytes — opaque here. */
  key: string;
  widthPx: number;
  heightPx: number;
};

/** Everything drawn on a page. Painted in order, so fills come before text. */
export type DrawOp =
  | {
      kind: "text";
      x: number;
      /** The baseline, not the top. */
      y: number;
      text: string;
      font: PdfFontStyle;
      sizePt: number;
      color: string;
    }
  | {
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      fill?: string;
      stroke?: string;
      lineWidth?: number;
      radius?: number;
    }
  | {
      kind: "ellipse";
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      fill?: string;
      stroke?: string;
      lineWidth?: number;
    }
  | {
      kind: "path";
      points: readonly (readonly [number, number])[];
      close?: boolean;
      fill?: string;
      stroke?: string;
      lineWidth?: number;
    }
  | {
      kind: "image";
      x: number;
      y: number;
      width: number;
      height: number;
      key: string;
    }
  /** A clickable region. Carries no ink — the underline is drawn separately. */
  | {
      kind: "link";
      x: number;
      y: number;
      width: number;
      height: number;
      href: string;
    };

export type PdfPage = { ops: DrawOp[] };

export type PdfLayout = {
  pages: readonly PdfPage[];
  widthPt: number;
  heightPt: number;
};

export type PdfLayoutInput = {
  title: string;
  body: string;
  settings: PdfSettings;
  measure: TextMeasurer;
  /**
   * The active display rules, compiled. The PDF shows what the *screen* shows,
   * so a `sensitive` rule masking a phone number keeps it masked in a document
   * made to be handed out. The Markdown and clipboard exports deliberately
   * differ — they are byte-exact copies of what was stored.
   */
  transforms?: readonly CompiledTransform[];
  resolveImage?: (href: string) => PdfImage | undefined;
};

// ---------------------------------------------------------------------------
// The look
// ---------------------------------------------------------------------------

// A document, not a screenshot of the app: black on white whatever the screen
// theme is, with the only other inks being the greys a printed page uses for
// rules and asides.
const INK = "#111111";
const INK_MUTED = "#444444";
const RULE = "#bbbbbb";
const FOOTER_INK = "#888888";

// Heading sizes as a multiple of the body size at `headingScale === 1`, scaled
// linearly by the setting: the excess over body size stretches or compresses,
// so `h6` stays at body size at every scale and `h1` fans out from it. Shared
// with what the live preview does on screen.
const HEADING_EXCESS: readonly number[] = [1.1, 0.7, 0.45, 0.25, 0.1, 0];

// Where the baseline sits inside a line box, as a fraction of the font size.
// The em box is centred in the line box and the baseline sits an ascender's
// height into it; 0.75 is close enough to the ascent of all four families that
// no line looks like it is sitting on the wrong shelf.
const ASCENT = 0.75;

// Vertical rhythm, all in ems of the body size, matching the live preview so a
// note reads the same on paper as it did on screen.
const BLOCK_GAP = 0.65;
const HEADING_GAP_ABOVE = 1.1;
const HEADING_GAP_BELOW = 0.45;
const HEADING_LEADING = 1.25;
const RULE_GAP = 1.2;
const LIST_INDENT = 1.7;
const MARKER_GAP = 0.2;
const QUOTE_INDENT = 0.9;
const QUOTE_BAR = 2.25;
const CODE_PAD_X = 0.8;
const CODE_PAD_Y = 0.6;
const CODE_RADIUS = 4;
const INLINE_CODE_PAD = 0.3;

/**
 * Lay a note out. The result is complete and self-describing: every page holds
 * everything drawn on it, in paint order, and nothing later re-reads the note.
 */
export function layoutPdf(input: PdfLayoutInput): PdfLayout {
  const layout = new Layout(input);
  layout.run();
  return layout.finish();
}

// ---------------------------------------------------------------------------
// The typesetter
// ---------------------------------------------------------------------------

/** A run of text with one resolved font — the atom line-breaking works over. */
type Piece = {
  text: string;
  font: PdfFontStyle;
  sizePt: number;
  color: string;
  /** Inline code paints a fill behind itself. */
  code: boolean;
  strike: boolean;
  href?: string;
};

/** Inline content is pieces, interrupted by the occasional picture. */
type InlineItem =
  | { kind: "piece"; piece: Piece }
  | { kind: "image"; href: string; alt: string };

/** A piece sliced to fit one line, with the width it was measured at. */
type Fragment = { piece: Piece; text: string; width: number };

type BlockContext = {
  /** Left edge of the text column for this block. */
  left: number;
  width: number;
  font: PdfFontStyle;
  sizePt: number;
  color: string;
};

class Layout {
  private readonly s: PdfSettings;
  private readonly measure: TextMeasurer;
  private readonly pages: DrawOp[][] = [[]];

  private readonly pageWidth: number;
  private readonly pageHeight: number;
  private readonly margin: number;
  private readonly contentWidth: number;
  private readonly contentBottom: number;

  private readonly bodyFamily: PdfFontFamily;
  private readonly headingFamily: PdfFontFamily;
  private readonly codeFamily: PdfFontFamily;
  private readonly codeSize: number;

  /** Top of the next block, in page coordinates. */
  private y: number;

  constructor(private readonly input: PdfLayoutInput) {
    this.s = input.settings;
    this.measure = input.measure;

    const page = pdfPageSizePt(this.s);
    this.pageWidth = page.widthPt;
    this.pageHeight = page.heightPt;
    this.margin = mmToPt(this.s.marginMm);
    this.contentWidth = this.pageWidth - this.margin * 2;
    this.contentBottom = this.pageHeight - this.margin;
    this.y = this.margin;

    this.bodyFamily = pdfBodyFamily(this.s.bodyFont);
    this.headingFamily = pdfHeadingFamily(this.s);
    this.codeFamily = pdfCodeFamily(this.s.codeFont);
    this.codeSize = this.s.fontSizePt * this.s.codeFontScale;
  }

  // -- page plumbing --------------------------------------------------------

  private get ops(): DrawOp[] {
    return this.pages[this.pages.length - 1]!;
  }

  private push(op: DrawOp): void {
    this.ops.push(op);
  }

  private newPage(): void {
    this.pages.push([]);
    this.y = this.margin;
  }

  /** Room left on this page for a block of `height`. */
  private fits(height: number): boolean {
    return this.y + height <= this.contentBottom;
  }

  /**
   * Make room for `height`, turning the page if there isn't any. A block taller
   * than a whole page is let through rather than looping: it will be split by
   * whoever is drawing it, or overflow, which beats an empty page.
   */
  private reserve(height: number): void {
    if (this.fits(height)) return;
    if (this.y > this.margin) this.newPage();
  }

  // -- the run --------------------------------------------------------------

  run(): void {
    this.drawTitle();

    const blocks = classifyLines(this.input.body);
    let i = 0;

    while (i < blocks.length) {
      const block = blocks[i]!;

      if (block.kind === "blank") {
        i += 1;
        continue;
      }

      if (block.kind === "heading") {
        this.drawHeading(block, blocks[i + 1]);
        i += 1;
        continue;
      }

      if (block.kind === "hr") {
        this.drawRule();
        i += 1;
        continue;
      }

      if (block.kind === "fence") {
        // The opening delimiter: everything up to the closing fence (or the end
        // of the note, for a fence nobody closed) is literal code.
        const lines: string[] = [];
        i += 1;
        while (i < blocks.length && blocks[i]!.kind === "code") {
          lines.push(blocks[i]!.raw);
          i += 1;
        }
        if (i < blocks.length && blocks[i]!.kind === "fence") i += 1;
        this.drawCodeBlock(lines);
        continue;
      }

      if (block.kind === "quote") {
        const lines: LineBlock[] = [];
        while (i < blocks.length && blocks[i]!.kind === "quote") {
          lines.push(blocks[i]!);
          i += 1;
        }
        this.drawQuote(lines);
        continue;
      }

      if (block.kind === "ul" || block.kind === "ol") {
        const start = i;
        while (
          i < blocks.length &&
          (blocks[i]!.kind === "ul" || blocks[i]!.kind === "ol")
        ) {
          i += 1;
        }
        // A run can open already indented (a note whose list starts nested), so
        // its own shallowest item — not zero — is what "top level" means here.
        const run = blocks.slice(start, i);
        const base = Math.min(...run.map((b) => b.depth ?? 0));
        for (const item of run)
          this.drawListItem(item, (item.depth ?? 0) - base);
        this.y += this.s.fontSizePt * BLOCK_GAP;
        continue;
      }

      // A paragraph run. Consecutive prose lines are one block with the
      // newlines the writer typed kept as hard breaks: in a line-based note a
      // newline is a break, not filler to be reflowed away.
      const lines: LineBlock[] = [];
      while (i < blocks.length && blocks[i]!.kind === "paragraph") {
        lines.push(blocks[i]!);
        i += 1;
      }
      this.drawParagraph(lines);
    }
  }

  finish(): PdfLayout {
    // There is always at least the page the constructor opened, so an empty
    // note exports as one blank sheet rather than as a zero-page (corrupt) PDF.
    if (this.s.pageNumbers) this.drawPageNumbers();
    return {
      pages: this.pages.map((ops) => ({ ops })),
      widthPt: this.pageWidth,
      heightPt: this.pageHeight,
    };
  }

  // -- blocks ---------------------------------------------------------------

  private drawTitle(): void {
    const title = this.input.title.trim();
    if (!this.s.includeTitle || !title) return;
    const context = this.titleContext(this.headingSize(1));
    // No rule under the title: its size already separates it from the body, and
    // a border there reads as a stray `---` the writer never typed.
    this.drawWrapped(this.inlineItems(title, context), {
      ...context,
      leading: HEADING_LEADING,
    });
    this.y += this.s.fontSizePt * 0.8;
  }

  private titleContext(size: number): BlockContext {
    return {
      left: this.margin,
      width: this.contentWidth,
      font: { family: this.headingFamily, bold: true, italic: false },
      sizePt: size,
      color: INK,
    };
  }

  private headingSize(level: number): number {
    const excess = HEADING_EXCESS[Math.min(5, Math.max(0, level - 1))]!;
    return this.s.fontSizePt * (1 + excess * this.s.headingScale);
  }

  private drawHeading(block: LineBlock, next: LineBlock | undefined): void {
    const level = Math.min(6, Math.max(1, block.level ?? 1));
    const size = this.headingSize(level);
    const context = this.titleContext(size);
    // A heading only ever opens something, so it is never left stranded at the
    // foot of a page: it moves down with the first line of what follows.
    const withNext =
      size * HEADING_LEADING +
      (next && next.kind !== "blank" ? this.lineBox : 0);
    if (this.y > this.margin) this.y += this.s.fontSizePt * HEADING_GAP_ABOVE;
    this.reserve(withNext);
    this.drawWrapped(this.inlineItems(block.content, context), {
      ...context,
      leading: HEADING_LEADING,
    });
    this.y += this.s.fontSizePt * HEADING_GAP_BELOW;
  }

  private drawRule(): void {
    const gap = this.s.fontSizePt * RULE_GAP;
    this.reserve(gap * 2);
    this.y += gap;
    this.push({
      kind: "rect",
      x: this.margin,
      y: this.y,
      width: this.contentWidth,
      height: 0.75,
      fill: RULE,
    });
    this.y += gap;
  }

  private drawParagraph(lines: readonly LineBlock[]): void {
    const context = this.bodyContext();
    for (const line of lines) {
      const items = this.inlineItems(line.content, context);
      this.drawItems(items, context);
    }
    this.y += this.s.fontSizePt * BLOCK_GAP;
  }

  private bodyContext(): BlockContext {
    return {
      left: this.margin,
      width: this.contentWidth,
      font: { family: this.bodyFamily, bold: false, italic: false },
      sizePt: this.s.fontSizePt,
      color: INK,
    };
  }

  private drawQuote(lines: readonly LineBlock[]): void {
    const indent = this.s.fontSizePt * QUOTE_INDENT;
    const context: BlockContext = {
      ...this.bodyContext(),
      left: this.margin + indent,
      width: this.contentWidth - indent,
      color: INK_MUTED,
    };
    // The bar is drawn per page-slice, after the text on that page, because
    // only then is it known how far down the page the quote actually ran.
    let page = this.pages.length;
    let barTop = this.y;
    const bar = (bottom: number, at: number) => {
      if (bottom <= barTop) return;
      this.pages[at]!.push({
        kind: "rect",
        x: this.margin,
        y: barTop,
        width: QUOTE_BAR,
        height: bottom - barTop,
        fill: RULE,
      });
    };

    for (const line of lines) {
      this.drawItems(this.inlineItems(line.content, context), context);
      if (this.pages.length !== page) {
        // The line carried the quote onto a new page: close the bar off at the
        // foot of the old one and start a fresh bar at the new top.
        bar(this.contentBottom, page - 1);
        page = this.pages.length;
        barTop = this.margin;
      }
    }
    bar(this.y, page - 1);
    this.y += this.s.fontSizePt * BLOCK_GAP;
  }

  private drawCodeBlock(lines: readonly string[]): void {
    const font: PdfFontStyle = {
      family: this.codeFamily,
      bold: false,
      italic: false,
    };
    const padX = this.codeSize * CODE_PAD_X;
    const padY = this.codeSize * CODE_PAD_Y;
    const filled = this.s.codeBackground !== PDF_CODE_BACKGROUND_NONE;
    const inner = this.contentWidth - (filled ? padX * 2 : 0);
    const leading = this.codeSize * this.s.lineHeight;

    // Code wraps rather than running off the sheet — there is no sideways on
    // paper — and breaks mid-token when a token is longer than the column,
    // which is what an unbroken URL or a deep indent usually is.
    const rows: string[] = [];
    for (const line of lines) {
      const wrapped = this.breakToWidth(line, font, this.codeSize, inner);
      rows.push(...wrapped);
    }
    if (rows.length === 0) rows.push("");

    let row = 0;
    while (row < rows.length) {
      // How many rows fit on what is left of this page. A block that doesn't
      // fit at all moves to a fresh page first; one that doesn't fit on a whole
      // page is split, because the alternative is losing the tail.
      const available = this.contentBottom - this.y - (filled ? padY * 2 : 0);
      const capacity = Math.floor(available / leading);
      if (capacity < 1) {
        if (this.y > this.margin) {
          this.newPage();
          continue;
        }
        // Nothing fits even on an empty page: draw one row and move on rather
        // than spin.
        this.drawCodeSlice(rows.slice(row, row + 1), font, filled, padX, padY);
        row += 1;
        continue;
      }
      const slice = rows.slice(row, row + capacity);
      this.drawCodeSlice(slice, font, filled, padX, padY);
      row += slice.length;
      if (row < rows.length) this.newPage();
    }
    this.y += this.s.fontSizePt * BLOCK_GAP;
  }

  private drawCodeSlice(
    rows: readonly string[],
    font: PdfFontStyle,
    filled: boolean,
    padX: number,
    padY: number,
  ): void {
    const leading = this.codeSize * this.s.lineHeight;
    const height = rows.length * leading + (filled ? padY * 2 : 0);
    if (filled) {
      this.push({
        kind: "rect",
        x: this.margin,
        y: this.y,
        width: this.contentWidth,
        height,
        fill: this.s.codeBackground,
        radius: CODE_RADIUS,
      });
    }
    let y = this.y + (filled ? padY : 0);
    for (const row of rows) {
      if (row.length > 0) {
        this.push({
          kind: "text",
          x: this.margin + (filled ? padX : 0),
          y: y + this.baselineIn(leading, this.codeSize),
          text: row,
          font,
          sizePt: this.codeSize,
          color: INK,
        });
      }
      y += leading;
    }
    this.y += height;
  }

  private drawListItem(item: LineBlock, depth: number): void {
    const step = this.s.fontSizePt * LIST_INDENT;
    const left = this.margin + step * (depth + 1);
    const context: BlockContext = {
      ...this.bodyContext(),
      left,
      width: this.margin + this.contentWidth - left,
    };
    // Claim the first line's worth of page *before* laying the content out, so
    // the marker and the line it belongs to can't end up on opposite sides of a
    // page break.
    this.reserve(this.lineBox);
    const markerPage = this.ops;
    const baseline = this.y + this.baselineIn(this.lineBox, this.s.fontSizePt);
    this.drawItems(this.inlineItems(item.content, context), context);
    // Every marker hangs from the same column, whatever shape it is: a box and
    // a bullet on consecutive rows must not sit at different left edges.
    const markerCentre = left - step * 0.55;
    if (item.task !== undefined) {
      this.drawCheckbox(markerPage, markerCentre, baseline, item.task);
    } else if (item.kind === "ol") {
      const marker = item.marker ?? item.ordinal ?? "1.";
      const font = context.font;
      const width = this.measure(marker, font, this.s.fontSizePt);
      markerPage.push({
        kind: "text",
        x: left - this.s.fontSizePt * MARKER_GAP - width,
        y: baseline,
        text: marker,
        font,
        sizePt: this.s.fontSizePt,
        color: INK,
      });
    } else {
      this.drawBullet(
        markerPage,
        bulletAt(this.s.bullet, depth),
        markerCentre,
        baseline,
      );
    }
  }

  // -- markers --------------------------------------------------------------

  /**
   * List markers are **drawn, not typed**: `•` is a character the standard
   * fonts happen to carry and `‣` is one they don't, whereas a filled circle is
   * two curves that always come out right and never drag in a font file.
   */
  private drawBullet(
    ops: DrawOp[],
    bullet: PdfBullet,
    x: number,
    baseline: number,
  ): void {
    const em = this.s.fontSizePt;
    // Centred on the lowercase x-height rather than the baseline, which is
    // where the eye expects a bullet to sit against the text beside it.
    const cy = baseline - em * 0.25;
    switch (bullet) {
      case "disc":
        ops.push({
          kind: "ellipse",
          cx: x,
          cy,
          rx: em * 0.14,
          ry: em * 0.14,
          fill: INK,
        });
        return;
      case "circle":
        ops.push({
          kind: "ellipse",
          cx: x,
          cy,
          rx: em * 0.13,
          ry: em * 0.13,
          stroke: INK,
          lineWidth: em * 0.075,
        });
        return;
      case "square":
        ops.push({
          kind: "rect",
          x: x - em * 0.12,
          y: cy - em * 0.12,
          width: em * 0.24,
          height: em * 0.24,
          fill: INK,
        });
        return;
      case "dash":
        ops.push({
          kind: "rect",
          x: x - em * 0.2,
          y: cy - em * 0.035,
          width: em * 0.4,
          height: em * 0.07,
          fill: INK,
        });
        return;
      case "arrow":
        ops.push({
          kind: "path",
          points: [
            [x - em * 0.11, cy - em * 0.15],
            [x + em * 0.16, cy],
            [x - em * 0.11, cy + em * 0.15],
          ],
          close: true,
          fill: INK,
        });
        return;
    }
  }

  /** A task row prints as a box showing its state — the PDF is read-only. */
  private drawCheckbox(
    ops: DrawOp[],
    centre: number,
    baseline: number,
    ticked: boolean,
  ): void {
    const em = this.s.fontSizePt;
    const size = em * 0.72;
    const x = centre - size / 2;
    const top = baseline - em * 0.62;
    ops.push({
      kind: "rect",
      x,
      y: top,
      width: size,
      height: size,
      stroke: ticked ? INK : INK_MUTED,
      lineWidth: em * 0.07,
      radius: em * 0.1,
    });
    if (!ticked) return;
    ops.push({
      kind: "path",
      points: [
        [x + size * 0.22, top + size * 0.52],
        [x + size * 0.42, top + size * 0.72],
        [x + size * 0.8, top + size * 0.26],
      ],
      stroke: INK,
      lineWidth: em * 0.1,
    });
  }

  private drawPageNumbers(): void {
    const size = Math.max(7, this.s.fontSizePt * 0.8);
    const font: PdfFontStyle = {
      family: this.bodyFamily,
      bold: false,
      italic: false,
    };
    // Centred in the bottom margin band — the same place the browser's print
    // engine used to stamp its own, minus the URL and the date nobody asked
    // for.
    const baseline = this.pageHeight - this.margin / 2 + size * 0.35;
    this.pages.forEach((ops, i) => {
      const label = `${i + 1} / ${this.pages.length}`;
      const width = this.measure(label, font, size);
      ops.push({
        kind: "text",
        x: this.margin + (this.contentWidth - width) / 2,
        y: baseline,
        text: label,
        font,
        sizePt: size,
        color: FOOTER_INK,
      });
    });
  }

  // -- inline ---------------------------------------------------------------

  private get lineBox(): number {
    return this.s.fontSizePt * this.s.lineHeight;
  }

  private baselineIn(lineBox: number, sizePt: number): number {
    return (lineBox - sizePt) / 2 + sizePt * ASCENT;
  }

  /** Parse a line, apply the display rules, and flatten it into styled runs. */
  private inlineItems(text: string, context: BlockContext): InlineItem[] {
    // Source offsets are the editor's caret bookkeeping and mean nothing on
    // paper, so the line is parsed from zero.
    const parsed = parseInline(text);
    const nodes = this.input.transforms?.length
      ? applyTransforms(parsed, this.input.transforms)
      : parsed;
    const out: InlineItem[] = [];
    this.flatten(nodes, context, base(context), out);
    return out;
  }

  private flatten(
    nodes: readonly InlineNode[],
    context: BlockContext,
    style: Piece,
    out: InlineItem[],
  ): void {
    const piece = (text: string, over: Partial<Piece> = {}) => {
      if (!text) return;
      out.push({ kind: "piece", piece: { ...style, ...over, text } });
    };

    for (const node of nodes) {
      switch (node.type) {
        case "text":
          piece(node.text);
          break;
        case "code":
          piece(node.text, {
            font: { family: this.codeFamily, bold: false, italic: false },
            sizePt: this.codeSize,
            code: true,
          });
          break;
        case "strong":
          this.flatten(node.children, context, bolder(style), out);
          break;
        case "em":
          this.flatten(node.children, context, italicised(style), out);
          break;
        case "strikethrough":
          this.flatten(node.children, context, { ...style, strike: true }, out);
          break;
        case "link": {
          const href = safeHref(node.href);
          piece(node.text, href ? { href } : {});
          break;
        }
        case "transform": {
          // A rewritten run prints as what it displays, never as its source: a
          // `sensitive` rule exists precisely so the original doesn't leave the
          // screen. A transformed link stays clickable when its target is an
          // inert scheme.
          const href =
            node.kind === "link" && node.href ? safeHref(node.href) : null;
          piece(node.text, href ? { href } : {});
          break;
        }
        case "image":
          out.push({ kind: "image", href: node.href, alt: node.alt });
          break;
      }
    }
  }

  /**
   * Draw a line's worth of inline content, breaking out any pictures. An image
   * interrupts the line rather than sitting in it: a note writes its pictures
   * on their own lines, and an inline box tall enough to hold one would wreck
   * the leading of the text either side.
   */
  private drawItems(items: readonly InlineItem[], context: BlockContext): void {
    let run: InlineItem[] = [];
    const flush = () => {
      if (run.length === 0) return;
      this.drawWrapped(run, { ...context, leading: this.s.lineHeight });
      run = [];
    };
    for (const item of items) {
      if (item.kind === "image") {
        flush();
        this.drawImage(item, context);
        continue;
      }
      run.push(item);
    }
    // A line that held nothing at all still occupies its line box — an empty
    // line in a note is spacing the writer typed.
    if (items.length === 0) {
      this.drawWrapped([], { ...context, leading: this.s.lineHeight });
      return;
    }
    flush();
  }

  private drawImage(
    item: InlineItem & { kind: "image" },
    context: BlockContext,
  ): void {
    const resolved = this.input.resolveImage?.(item.href);
    if (!resolved) {
      // An image the writer couldn't resolve degrades to its alt text rather
      // than to a blank hole, so the page still says what was meant to be here.
      const label = `[${item.alt || "image"}]`;
      this.drawWrapped(
        [
          {
            kind: "piece",
            piece: {
              ...base(context),
              text: label,
              color: INK_MUTED,
              font: { ...context.font, italic: true },
            },
          },
        ],
        { ...context, leading: this.s.lineHeight },
      );
      return;
    }
    // Pixels are CSS pixels; a PDF thinks in points, and 96dpi is the ratio the
    // rest of the web assumes.
    const naturalWidth = resolved.widthPx * 0.75;
    const naturalHeight = resolved.heightPx * 0.75;
    const scale = Math.min(
      1,
      context.width / naturalWidth,
      (this.contentBottom - this.margin) / naturalHeight,
    );
    const width = naturalWidth * scale;
    const height = naturalHeight * scale;
    this.reserve(height);
    this.push({
      kind: "image",
      x: context.left,
      y: this.y,
      width,
      height,
      key: resolved.key,
    });
    this.y += height + this.s.fontSizePt * 0.2;
  }

  /**
   * Fill lines with `items` and draw them, turning the page as needed. The
   * leading is a multiple of each line's own largest font, so a line carrying
   * inline code in a bigger size still gets room for it.
   */
  private drawWrapped(
    items: readonly InlineItem[],
    context: BlockContext & { leading: number },
  ): void {
    const lines = this.wrap(items, context.width);
    for (const line of lines) {
      const size = Math.max(context.sizePt, ...line.map((f) => f.piece.sizePt));
      const box = size * context.leading;
      this.reserve(box);
      this.drawLine(line, context.left, this.y, box);
      this.y += box;
    }
  }

  /** Break `items` into lines that fit `width`. */
  private wrap(items: readonly InlineItem[], width: number): Fragment[][] {
    const lines: Fragment[][] = [];
    let line: Fragment[] = [];
    let used = 0;

    const flush = () => {
      // Trailing spaces don't count against the margin, and never start a line.
      while (line.length > 0 && line[line.length - 1]!.text.trim() === "") {
        line.pop();
      }
      lines.push(line);
      line = [];
      used = 0;
    };

    for (const item of items) {
      if (item.kind !== "piece") continue;
      const piece = item.piece;
      for (const token of tokenise(piece.text)) {
        const blank = token.trim() === "";
        // A run of spaces never opens a line — the break it followed already
        // stands for it.
        if (blank && line.length === 0) continue;
        let text = token;
        let w = this.measure(text, piece.font, piece.sizePt);
        if (used + w <= width) {
          line.push({ piece, text, width: w });
          used += w;
          continue;
        }
        if (line.length > 0) {
          flush();
          if (blank) continue;
        }
        // A single token wider than the whole column (a long URL, a run of
        // code) has to be cut somewhere, or it would loop forever asking for a
        // fresh line it will never fit on either.
        while (w > width && text.length > 1) {
          const cut = this.fitPrefix(text, piece, width);
          line.push({
            piece,
            text: cut,
            width: this.measure(cut, piece.font, piece.sizePt),
          });
          flush();
          text = text.slice(cut.length);
          w = this.measure(text, piece.font, piece.sizePt);
        }
        line.push({ piece, text, width: w });
        used = w;
      }
    }
    if (line.length > 0) flush();
    if (lines.length === 0) lines.push([]);
    return lines;
  }

  /** The longest prefix of `text` that fits `width` — at least one character. */
  private fitPrefix(text: string, piece: Piece, width: number): string {
    let lo = 1;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.measure(text.slice(0, mid), piece.font, piece.sizePt) <= width) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return text.slice(0, lo);
  }

  /** Paint one filled line: code fills first, then text, then the decorations. */
  private drawLine(
    line: readonly Fragment[],
    left: number,
    top: number,
    box: number,
  ): void {
    let x = left;
    const filled = this.s.codeBackground !== PDF_CODE_BACKGROUND_NONE;

    for (const fragment of mergeRuns(line)) {
      const { piece } = fragment;
      const baseline = top + this.baselineIn(box, piece.sizePt);
      if (piece.code && filled && fragment.text.trim() !== "") {
        const pad = piece.sizePt * INLINE_CODE_PAD;
        this.push({
          kind: "rect",
          x: x - pad / 2,
          y: baseline - piece.sizePt * 0.82,
          width: fragment.width + pad,
          height: piece.sizePt * 1.12,
          fill: this.s.codeBackground,
          radius: 2,
        });
      }
      this.push({
        kind: "text",
        x,
        y: baseline,
        text: fragment.text,
        font: piece.font,
        sizePt: piece.sizePt,
        color: piece.color,
      });
      if (piece.href) {
        this.push({
          kind: "rect",
          x,
          y: baseline + piece.sizePt * 0.1,
          width: fragment.width,
          height: Math.max(0.4, piece.sizePt * 0.05),
          fill: piece.color,
        });
        this.push({
          kind: "link",
          x,
          y: top,
          width: fragment.width,
          height: box,
          href: piece.href,
        });
      }
      if (piece.strike) {
        this.push({
          kind: "rect",
          x,
          y: baseline - piece.sizePt * 0.25,
          width: fragment.width,
          height: Math.max(0.4, piece.sizePt * 0.05),
          fill: piece.color,
        });
      }
      x += fragment.width;
    }
  }

  /** Hard-break a string to `width`, keeping whole words where they fit. */
  private breakToWidth(
    text: string,
    font: PdfFontStyle,
    sizePt: number,
    width: number,
  ): string[] {
    if (this.measure(text, font, sizePt) <= width) return [text];
    const piece: Piece = {
      text,
      font,
      sizePt,
      color: INK,
      code: false,
      strike: false,
    };
    const out: string[] = [];
    let rest = text;
    while (rest.length > 0 && this.measure(rest, font, sizePt) > width) {
      const cut = this.fitPrefix(rest, piece, width);
      // Prefer to break at the last space in the cut, so wrapped code still
      // reads as words rather than as syllables.
      const space = cut.lastIndexOf(" ");
      const at = space > cut.length * 0.5 ? space + 1 : cut.length;
      out.push(rest.slice(0, at));
      rest = rest.slice(at);
    }
    out.push(rest);
    return out;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base(context: BlockContext): Piece {
  return {
    text: "",
    font: context.font,
    sizePt: context.sizePt,
    color: context.color,
    code: false,
    strike: false,
  };
}

function bolder(piece: Piece): Piece {
  return { ...piece, font: { ...piece.font, bold: true } };
}

function italicised(piece: Piece): Piece {
  return { ...piece, font: { ...piece.font, italic: true } };
}

/** Split into words and the runs of spaces between them, both kept. */
function tokenise(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

/**
 * Glue neighbouring fragments that share a style back into one. Line-breaking
 * works a token at a time, but a line of ordinary prose is one run as far as
 * the file is concerned — emitting a text op per word would set the font
 * dozens of times per line and pad the PDF for nothing.
 */
function mergeRuns(line: readonly Fragment[]): Fragment[] {
  const out: Fragment[] = [];
  for (const fragment of line) {
    const last = out[out.length - 1];
    if (last && last.piece === fragment.piece) {
      out[out.length - 1] = {
        piece: last.piece,
        text: last.text + fragment.text,
        width: last.width + fragment.width,
      };
      continue;
    }
    out.push(fragment);
  }
  return out;
}

const SAFE_LINK_SCHEME = /^(https?:|mailto:|tel:)/i;

// A link keeps its target only for schemes that mean something outside the app;
// anything else (`javascript:`, an app scheme, a relative path) prints as plain
// text. A note can arrive from a folder someone else syncs into, so its links
// are treated as untrusted.
function safeHref(href: string): string | undefined {
  const trimmed = href.trim();
  if (SAFE_LINK_SCHEME.test(trimmed)) return trimmed;
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
  return undefined;
}
