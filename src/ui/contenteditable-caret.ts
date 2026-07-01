// Caret helpers for the contenteditable live-preview editor
// (`MarkdownEditor.tsx`). The editor lets the browser own caret movement and
// selection natively, but it still needs to read where the caret is (as a
// source column on the active raw line) and to place the caret at a given
// column after it re-renders a line from formatted to raw. These are small,
// framework-free DOM utilities; the source↔DOM mapping for *formatted* lines
// lives in `markdown-selection.ts`.

/** The line element (`[data-line-index]`) a DOM node sits in, or null. */
export function lineElementOf(
  root: HTMLElement,
  node: Node | null,
): HTMLElement | null {
  if (!node) return null;
  const el =
    node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  const line = el?.closest("[data-line-index]");
  return line && root.contains(line) ? (line as HTMLElement) : null;
}

/** The source line index a line element represents, or null if unstamped. */
export function lineIndexOf(lineEl: HTMLElement | null): number | null {
  if (!lineEl) return null;
  const n = Number.parseInt(lineEl.dataset.lineIndex ?? "", 10);
  return Number.isNaN(n) ? null : n;
}

// The character offset of (`node`, `offset`) from the start of `lineEl`. On the
// active *raw* line the element's text is the verbatim source, so this offset is
// the source column directly — which is why the editor only calls it there.
export function offsetWithin(
  lineEl: HTMLElement,
  node: Node,
  offset: number,
): number {
  const range = lineEl.ownerDocument.createRange();
  range.setStart(lineEl, 0);
  try {
    range.setEnd(node, offset);
  } catch {
    // The node left the tree between selection and read; treat as line start.
    return 0;
  }
  return range.toString().length;
}

/** The current collapsed caret as a (node, offset), or null when none/ranged. */
export function collapsedCaret(): { node: Node; offset: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  return { node: range.startContainer, offset: range.startOffset };
}

// Place a collapsed caret `col` characters into `lineEl`'s text. Walks the
// line's text nodes to find the one that contains the column; falls back to the
// element itself (an empty line rendered as a lone <br>) so the caret still
// lands somewhere focusable.
export function placeCaret(lineEl: HTMLElement, col: number): void {
  const doc = lineEl.ownerDocument;
  const walker = doc.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
  let remaining = col;
  let node = walker.nextNode() as Text | null;
  let target: { node: Node; offset: number } | null = null;
  while (node) {
    const len = node.data.length;
    if (remaining <= len) {
      target = { node, offset: remaining };
      break;
    }
    remaining -= len;
    node = walker.nextNode() as Text | null;
  }
  // Past the end of all text (or no text at all): land at the line's end.
  if (!target) {
    const last = lastTextNode(lineEl);
    target = last
      ? { node: last, offset: last.data.length }
      : { node: lineEl, offset: 0 };
  }
  const range = doc.createRange();
  range.setStart(target.node, target.offset);
  range.collapse(true);
  const sel = doc.defaultView?.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

function lastTextNode(lineEl: HTMLElement): Text | null {
  const walker = lineEl.ownerDocument.createTreeWalker(
    lineEl,
    NodeFilter.SHOW_TEXT,
  );
  let last: Text | null = null;
  let node = walker.nextNode() as Text | null;
  while (node) {
    last = node;
    node = walker.nextNode() as Text | null;
  }
  return last;
}
