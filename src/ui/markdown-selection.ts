import { type LineBlock } from "../domain/markdown.ts";

// Maps a live-preview text selection back onto the raw note source.
//
// The editor renders each line as its own element and the caret's line as a
// textarea (see `MarkdownEditor.tsx`), so a native selection spans a column of
// rendered <div>s. Browsers would copy the *rendered* text — losing the
// Markdown a note-taker typed and, worse, copying a shortened bare URL as its
// elided `…[...]…` display rather than the real link. These helpers translate
// the selection's DOM endpoints into source `(line, column)` positions so the
// editor can put the verbatim source on the clipboard instead.

export type SourcePoint = { line: number; col: number };

// Resolve one selection endpoint (`node` + `offset`) to a source position, or
// null when it doesn't fall inside a rendered line of this editor (`root`).
// Each rendered line is stamped with `data-line-index`; each inline leaf with
// `data-src` (its first character's source column) and, where its rendered text
// differs in length from the source — a shortened bare URL — `data-len` (the
// source length) so the end of the leaf maps to the end of the *source* token.
export function sourcePointFromDom(
  root: HTMLElement,
  blocks: LineBlock[],
  node: Node,
  offset: number,
): SourcePoint | null {
  const startEl =
    node.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : (node as Element | null);
  if (!startEl) return null;
  const lineEl = startEl.closest("[data-line-index]");
  if (!lineEl || !root.contains(lineEl)) return null;
  const line = Number.parseInt(
    lineEl.getAttribute("data-line-index") ?? "",
    10,
  );
  if (Number.isNaN(line)) return null;

  const block = blocks[line];
  const contentStart = block?.contentStart ?? 0;

  // Walk up to the nearest source-stamped leaf within the line.
  let el: Element | null = startEl;
  while (
    el &&
    el !== lineEl &&
    !(el instanceof HTMLElement && el.dataset.src !== undefined)
  ) {
    el = el.parentElement;
  }
  if (!(el instanceof HTMLElement) || el.dataset.src === undefined) {
    // The marker glyph, a blank line, or other non-text node — snap to the
    // start of the line's content.
    return { line, col: contentStart };
  }

  const base = Number.parseInt(el.dataset.src, 10);
  if (Number.isNaN(base)) return { line, col: contentStart };
  const renderedLen = el.textContent?.length ?? 0;
  const parsedLen = el.dataset.len !== undefined ? Number(el.dataset.len) : NaN;
  const srcLen = Number.isNaN(parsedLen) ? renderedLen : parsedLen;
  const local = node.nodeType === Node.TEXT_NODE ? offset : 0;
  // At or past the visible end of the leaf, land on the end of the *source*
  // token (so a whole shortened URL copies in full); otherwise map 1:1.
  const col =
    local >= renderedLen ? base + srcLen : base + Math.min(local, srcLen);
  return { line, col };
}

function comparePoints(a: SourcePoint, b: SourcePoint): number {
  return a.line - b.line || a.col - b.col;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// The verbatim source text a selection spanning [a, b] covers. Endpoints are
// ordered; each line contributes the slice between the selected columns, with
// interior lines clamped to their content so a list/heading/quote marker (which
// the live preview draws as a non-selectable glyph) never leaks into the copy.
export function extractSourceRange(
  lines: string[],
  blocks: LineBlock[],
  a: SourcePoint,
  b: SourcePoint,
): string {
  const [start, end] = comparePoints(a, b) <= 0 ? [a, b] : [b, a];
  const parts: string[] = [];
  for (let i = start.line; i <= end.line; i++) {
    const raw = lines[i] ?? "";
    const block = blocks[i];
    const cs = block?.contentStart ?? 0;
    const ce = block ? cs + block.content.length : raw.length;
    const lo = i === start.line ? start.col : cs;
    const hi = i === end.line ? end.col : ce;
    parts.push(raw.slice(clamp(lo, 0, raw.length), clamp(hi, 0, raw.length)));
  }
  return parts.join("\n");
}
