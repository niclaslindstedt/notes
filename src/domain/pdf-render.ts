// Renders a note into a standalone, self-contained HTML document laid out for
// paper — the thing the export function hands to the browser's print engine to
// turn into a PDF. Pure: a string in, a string out, no DOM and no I/O, so it
// sits in `domain/` beside the parser it reads through and is unit-testable
// without a browser.
//
// **Why HTML and a print dialog rather than a PDF library.** The app ships no
// dependencies it doesn't have to (see AGENTS.md) and has no backend to render
// on, and every platform it runs on — browser, the WebView wrapper, Electron —
// already carries a production-grade PDF writer behind `window.print()`. So the
// export renders the note as a document, styles it for paper, and lets that
// engine do the typesetting. The caller (`src/ui/export/print-document.ts`)
// owns the iframe and the `print()` call; everything about how the page *looks*
// is decided here, from the user's `PdfSettings`.
//
// The document deliberately shares nothing with the app's screen theme: it is
// black on white in a print-safe font family, because a note exported to PDF
// should read as a document rather than as a screenshot of a dark editor.

import {
  classifyLines,
  parseInline,
  type InlineNode,
  type LineBlock,
} from "./markdown.ts";
import {
  bulletGlyphAt,
  pdfBodyFontStack,
  pdfCodeFontStack,
  pdfPageSizeCss,
  PDF_CODE_BACKGROUND_NONE,
  type PdfSettings,
} from "./pdf.ts";

export type PrintDocument = {
  /** The note's title, printed as the page heading when `includeTitle` is on. */
  title: string;
  /** The note's Markdown body. */
  body: string;
  settings: PdfSettings;
  /**
   * Resolve a body image reference — an `attachments/<file>` ref, typically —
   * to something the print document can actually draw (a `data:` URL). An
   * unresolved reference degrades to its alt text in brackets rather than to a
   * broken-image box: the print engine would otherwise draw a placeholder that
   * makes the PDF look damaged.
   */
  resolveImage?: (href: string) => string | undefined;
};

/**
 * Build the complete `<!doctype html>` document for a note. Everything is
 * inline — one `<style>`, no external requests — so the print engine has
 * nothing to wait for beyond the images the caller resolved.
 */
export function renderPrintDocument(doc: PrintDocument): string {
  const title = doc.title.trim();
  const heading =
    doc.settings.includeTitle && title
      ? `<h1 class="doc-title">${escapeHtml(title)}</h1>\n`
      : "";
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    // The document title is what most browsers pre-fill the "Save as PDF"
    // filename with, so it carries the note's name rather than "about:blank".
    `<title>${escapeHtml(title || "Note")}</title>`,
    `<style>${printStylesheet(doc.settings)}</style>`,
    "</head>",
    "<body>",
    heading + renderBody(doc),
    "</body>",
    "</html>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The stylesheet
// ---------------------------------------------------------------------------

// Heading sizes as a multiple of the body size at `headingScale === 1`, scaled
// linearly by the setting: the excess over body size stretches or compresses,
// so `h6` stays at body size at every scale and `h1` fans out from it.
const HEADING_EXCESS: readonly number[] = [1.1, 0.7, 0.45, 0.25, 0.1, 0];

function printStylesheet(s: PdfSettings): string {
  const codeBg = s.codeBackground;
  const codeFilled = codeBg !== PDF_CODE_BACKGROUND_NONE;
  const headings = HEADING_EXCESS.map(
    (excess, i) =>
      `h${i + 1}{font-size:${round(1 + excess * s.headingScale)}em}`,
  ).join("");
  // Five levels is more nesting than a note realistically carries; past that
  // the rotation repeats, which is what the editor does on screen too.
  const bullets = [0, 1, 2, 3, 4]
    .map(
      (depth) =>
        `li[data-bullet="${depth}"]>.marker::before{content:"${bulletGlyphAt(s.bullet, depth)}"}`,
    )
    .join("");
  return [
    `@page{size:${pdfPageSizeCss(s)};margin:${round(s.marginMm)}mm}`,
    "*{box-sizing:border-box}",
    "html,body{margin:0;padding:0}",
    `body{font-family:${pdfBodyFontStack(s.bodyFont)};font-size:${round(s.fontSizePt)}pt;line-height:${round(s.lineHeight)};color:#111;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}`,
    // Every block carries its own bottom margin only, so the first line of the
    // page sits flush against the top margin the user chose.
    "p,ul,ol,blockquote,pre,hr,table,figure{margin:0 0 0.65em}",
    "h1,h2,h3,h4,h5,h6{margin:1.1em 0 0.45em;line-height:1.25;font-weight:700;page-break-after:avoid;break-after:avoid}",
    ":is(h1,h2,h3,h4,h5,h6):first-child{margin-top:0}",
    headings,
    "h1.doc-title{margin:0 0 0.8em;padding-bottom:0.3em;border-bottom:1px solid #ccc}",
    // Notes are line-based on screen: a hard newline is a line break the writer
    // meant, so paragraphs keep theirs rather than reflowing into one run.
    "p{orphans:2;widows:2}",
    "hr{border:0;border-top:1px solid #bbb;margin:1.2em 0}",
    "a{color:inherit;text-decoration:underline}",
    "blockquote{padding-left:0.9em;border-left:3px solid #bbb;color:#444;page-break-inside:avoid;break-inside:avoid}",
    `code{font-family:${pdfCodeFontStack(s.codeFont)};font-size:${round(s.codeFontScale)}em${codeFilled ? `;background:${codeBg};padding:0.1em 0.3em;border-radius:3px` : ""}}`,
    `pre{font-family:${pdfCodeFontStack(s.codeFont)};font-size:${round(s.codeFontScale)}em;white-space:pre-wrap;overflow-wrap:break-word;page-break-inside:avoid;break-inside:avoid${codeFilled ? `;background:${codeBg};padding:0.6em 0.8em;border-radius:4px` : ";padding:0"}}`,
    // A `<code>` inside a `<pre>` must not paint its own fill on top of the
    // block's, or every line would show a slightly darker inner slab.
    "pre code{background:none;padding:0;border-radius:0;font-size:inherit}",
    // Lists draw their own markers so the bullet glyph, the ordered-marker
    // style, and the checkbox all come from one place — and so the ordered
    // numbering matches what the editor showed on screen exactly.
    "ul,ol{list-style:none;padding-left:1.7em}",
    "li{position:relative;page-break-inside:avoid;break-inside:avoid}",
    "li>.marker{position:absolute;left:-1.7em;width:1.5em;text-align:right}",
    bullets,
    "li.task>.marker{font-family:inherit}",
    "ul ul,ul ol,ol ul,ol ol{margin:0}",
    "img{max-width:100%;page-break-inside:avoid;break-inside:avoid}",
    ".missing-image{color:#666;font-style:italic}",
  ].join("");
}

// Trim float noise so the stylesheet reads cleanly (`1.5`, not `1.5000000002`).
function round(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

// ---------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------

function renderBody(doc: PrintDocument): string {
  const blocks = classifyLines(doc.body);
  const out: string[] = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i]!;

    if (block.kind === "blank") {
      i += 1;
      continue;
    }

    if (block.kind === "heading") {
      const level = Math.min(6, Math.max(1, block.level ?? 1));
      out.push(`<h${level}>${renderInline(block.content, doc)}</h${level}>`);
      i += 1;
      continue;
    }

    if (block.kind === "hr") {
      out.push("<hr>");
      i += 1;
      continue;
    }

    if (block.kind === "fence") {
      // The opening delimiter: take every line up to the closing fence (or the
      // end of the note, for a fence the writer never closed) as literal code.
      const lines: string[] = [];
      i += 1;
      while (i < blocks.length && blocks[i]!.kind === "code") {
        lines.push(blocks[i]!.raw);
        i += 1;
      }
      // Step over the closing delimiter when there is one.
      if (i < blocks.length && blocks[i]!.kind === "fence") i += 1;
      out.push(`<pre><code>${escapeHtml(lines.join("\n"))}</code></pre>`);
      continue;
    }

    if (block.kind === "quote") {
      const lines: string[] = [];
      while (i < blocks.length && blocks[i]!.kind === "quote") {
        lines.push(renderInline(blocks[i]!.content, doc));
        i += 1;
      }
      out.push(`<blockquote><p>${lines.join("<br>")}</p></blockquote>`);
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
      // the run's own shallowest item — not zero — is what "top level" means
      // here; otherwise every sibling after the first would hang off it.
      const run = blocks.slice(start, i);
      const base = Math.min(...run.map((b) => b.depth ?? 0));
      out.push(renderList(run, base, doc));
      continue;
    }

    // A paragraph run. Consecutive non-blank prose lines become one paragraph
    // with hard breaks between them: in a line-based note a newline is a break
    // the writer typed, not filler to be reflowed away.
    const lines: string[] = [];
    while (i < blocks.length && blocks[i]!.kind === "paragraph") {
      lines.push(renderInline(blocks[i]!.content, doc));
      i += 1;
    }
    out.push(`<p>${lines.join("<br>")}</p>`);
  }

  return out.join("\n");
}

/**
 * Render one run of list lines into nested `<ul>` / `<ol>` elements, driven by
 * the `depth` the parser assigned each item. Called recursively: every item
 * deeper than `depth` belongs to the item that precedes it, and becomes a
 * sublist inside that `<li>`.
 */
function renderList(
  items: readonly LineBlock[],
  depth: number,
  doc: PrintDocument,
): string {
  const kind = items[0]?.kind === "ol" ? "ol" : "ul";
  const parts: string[] = [];
  let i = 0;

  while (i < items.length) {
    const item = items[i]!;
    i += 1;
    // Everything deeper than this item, up to the next one at this level, is
    // its sublist. Taking `items[i]` unconditionally as an item at this level
    // is also what keeps a skipped indentation level from recursing forever.
    const start = i;
    while (i < items.length && (items[i]!.depth ?? 0) > depth) i += 1;
    const nested =
      i > start ? renderList(items.slice(start, i), depth + 1, doc) : "";
    parts.push(renderItem(item, depth, nested, doc));
  }

  return `<${kind}>${parts.join("")}</${kind}>`;
}

function renderItem(
  item: LineBlock,
  depth: number,
  nested: string,
  doc: PrintDocument,
): string {
  const content = renderInline(item.content, doc);
  if (item.task !== undefined) {
    // A task item prints as a box that shows its state — the PDF is a
    // read-only artefact, so a ticked box beats an interactive control.
    const box = item.task ? "☑" : "☐";
    return `<li class="task"><span class="marker">${box}</span>${content}${nested}</li>`;
  }
  if (item.kind === "ol") {
    // The parser already computed the display marker across the whole list
    // (numeric → alpha → roman by depth), so the PDF numbers exactly as the
    // editor did on screen.
    const marker = escapeHtml(item.marker ?? item.ordinal ?? "1.");
    return `<li><span class="marker">${marker}</span>${content}${nested}</li>`;
  }
  // The bullet glyph itself comes from the stylesheet, keyed by this attribute,
  // so changing the setting re-skins every level without touching the markup.
  return `<li data-bullet="${Math.min(4, depth)}"><span class="marker"></span>${content}${nested}</li>`;
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

function renderInline(text: string, doc: PrintDocument): string {
  return renderNodes(parseInline(text), doc);
}

function renderNodes(nodes: readonly InlineNode[], doc: PrintDocument): string {
  return nodes.map((node) => renderNode(node, doc)).join("");
}

function renderNode(node: InlineNode, doc: PrintDocument): string {
  switch (node.type) {
    case "text":
      return escapeHtml(node.text);
    case "code":
      return `<code>${escapeHtml(node.text)}</code>`;
    case "strong":
      return `<strong>${renderNodes(node.children, doc)}</strong>`;
    case "em":
      return `<em>${renderNodes(node.children, doc)}</em>`;
    case "strikethrough":
      return `<del>${renderNodes(node.children, doc)}</del>`;
    case "link": {
      const href = safeHref(node.href);
      const label = escapeHtml(node.text);
      return href ? `<a href="${escapeAttr(href)}">${label}</a>` : label;
    }
    case "image": {
      const src = doc.resolveImage?.(node.href) ?? safeImageSrc(node.href);
      const alt = escapeHtml(node.alt);
      if (!src) return `<span class="missing-image">[${alt}]</span>`;
      return `<img src="${escapeAttr(src)}" alt="${alt}">`;
    }
  }
}

// The document is assembled as a string and handed to a print engine, so every
// piece of note text that reaches it is escaped, and every URL is allowlisted
// by scheme. A note is user-authored content that can arrive from a synced
// folder someone else wrote to, so it is treated as untrusted throughout.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

const SAFE_LINK_SCHEME = /^(https?:|mailto:|tel:)/i;

// A link keeps its href only for schemes that are inert on paper; anything else
// (`javascript:`, an app scheme, a relative path that means nothing outside the
// app) prints as plain text.
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (SAFE_LINK_SCHEME.test(trimmed)) return trimmed;
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
  return null;
}

// An image the caller couldn't resolve is only drawn when it points at
// something the print document can fetch on its own: an inline `data:` image or
// an absolute http(s) URL.
function safeImageSrc(href: string): string | null {
  const trimmed = href.trim();
  if (/^data:image\//i.test(trimmed)) return trimmed;
  if (/^https?:/i.test(trimmed)) return trimmed;
  return null;
}
