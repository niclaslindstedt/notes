import { type SourcePoint } from "../domain/line-edit.ts";
import { type LineBlock } from "../domain/markdown.ts";
import { lineIndexOf, offsetWithin } from "./contenteditable-caret.ts";

// Maps a live-preview text selection back onto the raw note source.
//
// The editor renders each line as its own element within one contenteditable
// surface (see `MarkdownEditor.tsx`), so a native selection spans a column of
// rendered <div>s. Browsers would copy the *rendered* text — losing the
// Markdown a note-taker typed and, worse, copying a shortened bare URL as its
// elided `…[...]…` display rather than the real link. These helpers translate
// the selection's DOM endpoints into source `(line, column)` positions so the
// editor can put the verbatim source on the clipboard instead.

export type { SourcePoint };

// Resolve one selection endpoint (`node` + `offset`) to a source position, or
// null when it doesn't fall inside a rendered line of this editor (`root`).
// Each rendered line is stamped with `data-line-index`; each inline leaf with
// `data-src` (its first character's source column) and, where its rendered text
// differs in length from the source — a shortened bare URL — `data-len` (the
// source length) so the end of the leaf maps to the end of the *source* token.
// An endpoint anchored on a container *between* the surface and its lines — or
// on the surface itself — is resolved to the nearest line edge by
// `containerPoint` rather than given up on.
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
  if (!lineEl || !root.contains(lineEl))
    return containerPoint(root, blocks, node, offset);
  const line = Number.parseInt(
    lineEl.getAttribute("data-line-index") ?? "",
    10,
  );
  if (Number.isNaN(line)) return null;

  // The active line renders as raw source (`data-raw`), so a DOM offset into it
  // *is* the source column — no inline leaf mapping needed.
  if (lineEl instanceof HTMLElement && lineEl.dataset.raw !== undefined) {
    return { line, col: offsetWithin(lineEl, node, offset) };
  }

  const block = blocks[line];
  const contentStart = block?.contentStart ?? 0;

  // An endpoint anchored at the line container itself (rather than a text leaf)
  // — e.g. Ctrl+A's range boundaries `(lineEl, 0)` / `(lineEl, childCount)` —
  // maps to the true line edge, markers included, so select-all covers the
  // whole source line and a delete/replace leaves nothing behind.
  if (node === lineEl) {
    return { line, col: offset <= 0 ? 0 : (block?.raw.length ?? 0) };
  }

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

// Resolve a selection endpoint anchored on the editing surface itself (or on a
// wrapper between it and the lines) to the nearest line edge.
//
// The editor's own Ctrl/Cmd+A anchors its range inside the first and last line
// elements precisely so both endpoints map back to source — but a selection the
// *browser* draws has no such manners. iOS Safari's native "Select All" (the
// one in the text-selection callout, which is how a note gets erased on a
// phone) runs the range from `(surface, 0)` to `(surface, childCount)`, and
// WebKit anchors on the surface for whole-document deletes besides. Returning
// null for those endpoints meant the editor couldn't map the edit, so it
// declined to intercept it and the browser applied the delete itself — tearing
// out the line elements React believes it owns. The next render then tried to
// reconcile against nodes that were gone, threw, and took the whole app down
// with it (a blank screen until the app is restarted).
//
// A DOM boundary `(el, offset)` sits *before* `el.childNodes[offset]`, so the
// endpoint maps to the start of the first line at or after that child, and to
// the end of the last line when the offset runs past the children.
function containerPoint(
  root: HTMLElement,
  blocks: LineBlock[],
  node: Node,
  offset: number,
): SourcePoint | null {
  const el =
    node.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : (node as Element | null);
  if (!el || !root.contains(el)) return null;
  const lineEls = root.querySelectorAll<HTMLElement>("[data-line-index]");
  if (lineEls.length === 0) return null;

  // A stray text node the browser parked outside every line carries a character
  // offset, not a child index, so the boundary is taken as sitting before the
  // node itself.
  const next =
    node.nodeType === Node.TEXT_NODE ? node : (el.childNodes[offset] ?? null);
  if (next) {
    for (const lineEl of lineEls) {
      const atOrAfter =
        lineEl === next ||
        (next.compareDocumentPosition(lineEl) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
          0;
      const line = atOrAfter ? lineIndexOf(lineEl) : null;
      if (line !== null) return { line, col: 0 };
    }
  }

  const line = lineIndexOf(lineEls[lineEls.length - 1] ?? null);
  return line === null ? null : { line, col: blocks[line]?.raw.length ?? 0 };
}

// A block marker (`# `, `- `, `> `, `1. `) is drawn as a non-selectable glyph
// (or, for a heading, not drawn at all), so the browser can't anchor a selection
// *before* it — the earliest a selection endpoint can land on a line is its
// content start. For a ranged selection (copy / cut / replace) that means a
// selection reaching a line's content start has visually taken the whole line,
// so snap that start back to column 0 to include the leading marker. Only the
// *start* endpoint needs this (markers are leading; a line's end already covers
// its content), and only for a range — a collapsed caret still lands after the
// marker, where editing happens.
//
// `rawLine` is the active line, which renders as verbatim source: its marker is
// ordinary text there, so the browser *can* address it and a range that starts
// at the content start means exactly that. Snapping it would widen a span the
// browser scoped precisely — which is what a phone's autocorrect hands over
// when it rewrites the first word of a list item ("4. Somethign" → the word
// alone), and swallowing the marker turned that into "Something".
export function snapStartToLineEdge(
  blocks: LineBlock[],
  start: SourcePoint,
  rawLine: number | null = null,
): SourcePoint {
  if (start.line === rawLine) return start;
  const contentStart = blocks[start.line]?.contentStart ?? 0;
  return start.col <= contentStart ? { line: start.line, col: 0 } : start;
}

function comparePoints(a: SourcePoint, b: SourcePoint): number {
  return a.line - b.line || a.col - b.col;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// The verbatim source text a selection spanning [a, b] covers — raw Markdown,
// list/heading/quote markers and all, so a copy round-trips as the source it was
// typed as. Endpoints are ordered; the first and last lines contribute the slice
// from/to the selected column, and every interior line is taken in full.
export function extractSourceRange(
  lines: string[],
  a: SourcePoint,
  b: SourcePoint,
): string {
  const [start, end] = comparePoints(a, b) <= 0 ? [a, b] : [b, a];
  const parts: string[] = [];
  for (let i = start.line; i <= end.line; i++) {
    const raw = lines[i] ?? "";
    const lo = i === start.line ? start.col : 0;
    const hi = i === end.line ? end.col : raw.length;
    parts.push(raw.slice(clamp(lo, 0, raw.length), clamp(hi, 0, raw.length)));
  }
  return parts.join("\n");
}
