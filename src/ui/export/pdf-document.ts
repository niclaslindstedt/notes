// Writes the PDF. Takes the pages the [layout engine](../../domain/pdf-layout.ts)
// produced and paints them with jsPDF, then hands back the bytes.
//
// This is the only module in the app that knows jsPDF exists, and it is
// imported on the export press — never at mount — so nobody who doesn't export
// downloads a PDF writer (see AGENTS.md, "the code-splitting seams").
//
// **Fonts.** A PDF names its fonts rather than carrying them, and every reader
// already has the *standard* fonts — Helvetica, Times, Courier — so the ordinary
// note costs the file nothing. Their limit is that they only encode Latin-1, so
// text is scanned for characters they can't express and those runs are drawn in
// an embedded fallback instead (`src/assets/fonts/`), which is fetched the first
// time a note actually needs it. That substitution has to happen identically on
// both sides of the layout seam — the measurer below and `paintText` split runs
// with the same function, or a Cyrillic line would be measured as one font and
// drawn in another.

import {
  layoutPdf,
  type DrawOp,
  type PdfFontStyle,
  type PdfImage,
  type PdfLayout,
  type TextMeasurer,
} from "../../domain/pdf-layout.ts";
import {
  pdfPageSizePt,
  type PdfFontFamily,
  type PdfSettings,
} from "../../domain/pdf.ts";
import type { CompiledTransform } from "../../domain/transform.ts";

const logScope = "export";

/** What the writer needs beyond the note itself. */
export type PdfBuildInput = {
  title: string;
  body: string;
  settings: PdfSettings;
  transforms?: readonly CompiledTransform[];
  /** Image attachments by filename, already fetched and sized. */
  images?: ReadonlyMap<string, LoadedImage>;
  /** Resolve a Markdown image href to a key in `images`. */
  imageKeyFor?: (href: string) => string | undefined;
  /** The translated `of` for the `1 of 7` footer — see `PdfLayoutInput`. */
  pageNumberOf?: string;
};

export type LoadedImage = {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
};

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

// jsPDF's names for the three standard families. `fallback` and `dejavuMono`
// are registered under their own names once their file has been loaded.
const STANDARD: Partial<Record<PdfFontFamily, string>> = {
  helvetica: "helvetica",
  times: "times",
  courier: "courier",
};

const FALLBACK_FONT = "NotesFallback";
const MONO_FONT = "NotesMono";

// The standard fonts are encoded as WinAnsi, which is Latin-1 plus a handful of
// typographic extras in the 0x80–0x9F hole. Anything outside that has to come
// from the embedded font.
const WIN_ANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

function inWinAnsi(codePoint: number): boolean {
  if (codePoint === 0x0a || codePoint === 0x09) return true;
  if (codePoint >= 0x20 && codePoint <= 0x7e) return true;
  if (codePoint >= 0xa0 && codePoint <= 0xff) return true;
  return WIN_ANSI_EXTRAS.has(codePoint);
}

/**
 * Split `text` into runs that one font can draw. A run is either entirely
 * expressible in the requested family or entirely not, and the caller draws the
 * second kind in the fallback. Called by both the measurer and the painter, so
 * the two can't disagree about where a line ends.
 */
function coverageRuns(
  text: string,
  family: PdfFontFamily,
): { text: string; fallback: boolean }[] {
  // The embedded fonts are Unicode-encoded, so nothing needs substituting.
  if (family === "fallback" || family === "dejavuMono") {
    return [{ text, fallback: false }];
  }
  const runs: { text: string; fallback: boolean }[] = [];
  for (const char of text) {
    const needs = !inWinAnsi(char.codePointAt(0) ?? 0);
    const last = runs[runs.length - 1];
    if (last && last.fallback === needs) last.text += char;
    else runs.push({ text: char, fallback: needs });
  }
  return runs;
}

/** Whether a note needs the Unicode fallback at all. */
function needsFallback(text: string): boolean {
  for (const char of text) {
    if (!inWinAnsi(char.codePointAt(0) ?? 0)) return true;
  }
  return false;
}

// The font files are assets rather than imports so they stay out of every
// bundle; Vite rewrites these to the hashed URLs at build time.
const FALLBACK_URLS = {
  regular: new URL(
    "../../assets/fonts/dejavu-sans-subset.ttf",
    import.meta.url,
  ),
  bold: new URL(
    "../../assets/fonts/dejavu-sans-bold-subset.ttf",
    import.meta.url,
  ),
  mono: new URL("../../assets/fonts/dejavu-mono-subset.ttf", import.meta.url),
};

async function fetchFontBase64(url: URL): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    // btoa wants a binary string, and a font is far too big for
    // `String.fromCharCode(...bytes)` — that spreads a megabyte of arguments
    // onto the stack.
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  } catch {
    // Offline, or a wrapper serving the page from a file: URL where the fetch
    // isn't permitted. The export goes ahead in the standard fonts and the odd
    // character comes out as a blank — a document missing an accent beats no
    // document at all.
    return null;
  }
}

type Doc = import("jspdf").jsPDF;

/** Register the embedded faces this document turns out to need. */
async function loadFonts(
  doc: Doc,
  settings: PdfSettings,
  text: string,
): Promise<{ fallback: boolean; mono: boolean }> {
  const wantFallback = needsFallback(text);
  const wantMono = settings.codeFont === "dejavu";
  const [regular, bold, mono] = await Promise.all([
    wantFallback ? fetchFontBase64(FALLBACK_URLS.regular) : null,
    wantFallback ? fetchFontBase64(FALLBACK_URLS.bold) : null,
    wantMono ? fetchFontBase64(FALLBACK_URLS.mono) : null,
  ]);

  if (regular) {
    doc.addFileToVFS("notes-fallback.ttf", regular);
    doc.addFont("notes-fallback.ttf", FALLBACK_FONT, "normal");
    // Without a bold face registered, jsPDF silently falls back to the normal
    // one; with it, a Cyrillic heading is actually bold.
    if (bold) {
      doc.addFileToVFS("notes-fallback-bold.ttf", bold);
      doc.addFont("notes-fallback-bold.ttf", FALLBACK_FONT, "bold");
    }
  }
  if (mono) {
    doc.addFileToVFS("notes-mono.ttf", mono);
    doc.addFont("notes-mono.ttf", MONO_FONT, "normal");
  }
  return { fallback: Boolean(regular), mono: Boolean(mono) };
}

/**
 * Point jsPDF at a face. `available` says which embedded fonts actually
 * loaded, so a failed fetch degrades to a standard font rather than to jsPDF's
 * "font not found" default, which is not the same size.
 */
function setFont(
  doc: Doc,
  font: PdfFontStyle,
  fallback: boolean,
  available: { fallback: boolean; mono: boolean },
): void {
  if (fallback && available.fallback) {
    doc.setFont(FALLBACK_FONT, font.bold ? "bold" : "normal");
    return;
  }
  if (font.family === "dejavuMono" && available.mono) {
    doc.setFont(MONO_FONT, "normal");
    return;
  }
  const name = STANDARD[font.family] ?? "helvetica";
  const style = font.bold
    ? font.italic
      ? "bolditalic"
      : "bold"
    : font.italic
      ? "italic"
      : "normal";
  doc.setFont(name, style);
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

function paintText(
  doc: Doc,
  op: Extract<DrawOp, { kind: "text" }>,
  available: { fallback: boolean; mono: boolean },
): void {
  doc.setFontSize(op.sizePt);
  doc.setTextColor(op.color);
  let x = op.x;
  for (const run of coverageRuns(op.text, op.font.family)) {
    setFont(doc, op.font, run.fallback, available);
    doc.text(run.text, x, op.y, { baseline: "alphabetic" });
    x += doc.getTextWidth(run.text);
  }
}

function paintOp(
  doc: Doc,
  op: DrawOp,
  images: ReadonlyMap<string, LoadedImage>,
  available: { fallback: boolean; mono: boolean },
): void {
  switch (op.kind) {
    case "text":
      paintText(doc, op, available);
      return;
    case "rect": {
      if (op.fill) doc.setFillColor(op.fill);
      if (op.stroke) doc.setDrawColor(op.stroke);
      if (op.lineWidth) doc.setLineWidth(op.lineWidth);
      const style = op.fill ? (op.stroke ? "FD" : "F") : "S";
      if (op.radius) {
        doc.roundedRect(
          op.x,
          op.y,
          op.width,
          op.height,
          op.radius,
          op.radius,
          style,
        );
      } else {
        doc.rect(op.x, op.y, op.width, op.height, style);
      }
      return;
    }
    case "ellipse":
      if (op.fill) doc.setFillColor(op.fill);
      if (op.stroke) doc.setDrawColor(op.stroke);
      if (op.lineWidth) doc.setLineWidth(op.lineWidth);
      doc.ellipse(op.cx, op.cy, op.rx, op.ry, op.fill ? "F" : "S");
      return;
    case "path": {
      const [first, ...rest] = op.points;
      if (!first) return;
      if (op.fill) doc.setFillColor(op.fill);
      if (op.stroke) doc.setDrawColor(op.stroke);
      doc.setLineWidth(op.lineWidth ?? 1);
      // jsPDF's `lines` walks *deltas* from the starting point, not absolute
      // coordinates.
      let [px, py] = first;
      const deltas = rest.map(([x, y]) => {
        const step: [number, number] = [x - px, y - py];
        px = x;
        py = y;
        return step;
      });
      doc.lines(
        deltas,
        first[0],
        first[1],
        [1, 1],
        op.fill ? "F" : "S",
        op.close,
      );
      return;
    }
    case "image": {
      const image = images.get(op.key);
      if (!image) return;
      try {
        doc.addImage(image.dataUrl, op.x, op.y, op.width, op.height);
      } catch (err) {
        // A picture in a format jsPDF can't read must not cost the document.
        console.warn(`[${logScope}] image skipped`, err);
      }
      return;
    }
    case "link":
      doc.link(op.x, op.y, op.width, op.height, { url: op.href });
      return;
  }
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

/**
 * Lay the note out and write it. Returns the finished PDF, or `null` if the
 * writer couldn't be loaded at all.
 */
export async function buildPdf(input: PdfBuildInput): Promise<Blob | null> {
  const { jsPDF } = await import("jspdf");
  const { settings } = input;

  // The page box comes from the same helper the layout uses, which has already
  // applied the orientation — so the document is opened at explicit dimensions
  // rather than by paper name, and jsPDF is given no second chance to rotate
  // it.
  const page = pdfPageSizePt(settings);
  const doc = new jsPDF({
    unit: "pt",
    format: [page.widthPt, page.heightPt],
    compress: true,
  });

  const available = await loadFonts(
    doc,
    settings,
    `${input.title}\n${input.body}`,
  );

  // jsPDF measures in the current font at the current size, so the measurer
  // sets both before asking — and splits runs exactly as the painter will.
  const measure: TextMeasurer = (text, font, sizePt) => {
    doc.setFontSize(sizePt);
    let width = 0;
    for (const run of coverageRuns(text, font.family)) {
      setFont(doc, font, run.fallback, available);
      width += doc.getTextWidth(run.text);
    }
    return width;
  };

  const images = input.images ?? new Map<string, LoadedImage>();
  const layout = layoutPdf({
    title: input.title,
    body: input.body,
    settings,
    measure,
    transforms: input.transforms,
    pageNumberOf: input.pageNumberOf,
    resolveImage: (href): PdfImage | undefined => {
      const key = input.imageKeyFor?.(href);
      const image = key ? images.get(key) : undefined;
      if (!key || !image) return undefined;
      return { key, widthPx: image.widthPx, heightPx: image.heightPx };
    },
  });

  paint(doc, layout, images, available);
  return doc.output("blob");
}

function paint(
  doc: Doc,
  layout: PdfLayout,
  images: ReadonlyMap<string, LoadedImage>,
  available: { fallback: boolean; mono: boolean },
): void {
  layout.pages.forEach((page, index) => {
    if (index > 0) doc.addPage([layout.widthPt, layout.heightPt]);
    for (const op of page.ops) paintOp(doc, op, images, available);
  });
}
