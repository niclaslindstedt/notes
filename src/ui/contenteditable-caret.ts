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

/**
 * The caret's own on-screen rect inside `lineEl`, or null when the selection
 * isn't in this element (or the browser reports no geometry for it — a
 * collapsed range on an empty line).
 *
 * A soft-wrapped line can be many screens tall, so the *element's* rect says
 * nothing about where the caret sits within it. Anything scrolling the caret
 * into view measures this instead, or the two ends and the middle of one long
 * line all reveal the same place: the middle of the element's box.
 */
export function caretRectWithin(lineEl: HTMLElement): DOMRect | null {
  const sel = lineEl.ownerDocument.defaultView?.getSelection?.();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!lineEl.contains(range.startContainer)) return null;
  // A boundary that sits on an *element* rather than inside text — which is how
  // a whole-line span starts, at `(line, 0)` — is measured by stepping into the
  // first character after it. The range's own rect list can't answer here: it
  // leads with the border box of each element the range swallows whole, and a
  // line element's box is as tall as every row it wraps to, so reading the
  // first rect would hand back the middle of a long line rather than its head.
  const stepped = firstCharRect(
    lineEl,
    range.startContainer,
    range.startOffset,
  );
  if (stepped) return stepped;
  // A range that spans wrapped rows reports one rect per row, so the first is
  // the row the selection *starts* on — the end the user is anchored to. The
  // bounding rect is the fallback for engines that hand back an empty list for
  // a collapsed caret; a zero-height result means neither knew, so the caller
  // falls back to the element.
  const rects = range.getClientRects?.();
  const rect =
    rects && rects.length > 0 ? rects[0]! : range.getBoundingClientRect?.();
  return rect && rect.height > 0 ? rect : null;
}

/**
 * The rect of the first character at or after an element boundary
 * (`node`, `offset`), searching inside `root`. Null when the boundary is
 * already in text (there is nothing to step into), when no text follows it, or
 * when the engine reports no geometry.
 *
 * One character rather than a collapsed point, because a range with something
 * in it is what every engine reports geometry for — and a single character can
 * only occupy one row, which is the whole reason for measuring here.
 */
function firstCharRect(
  root: HTMLElement,
  node: Node,
  offset: number,
): DOMRect | null {
  if (node.nodeType === Node.TEXT_NODE) return null;
  const from = node.childNodes[offset];
  if (!from) return null;
  const text = firstTextFrom(root, from);
  if (!text) return null;
  const range = root.ownerDocument.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 1);
  const rect = range.getBoundingClientRect?.();
  return rect && rect.height > 0 ? rect : null;
}

/** The first text node with characters in it at or after `from`, within `root`. */
function firstTextFrom(root: HTMLElement, from: Node): Text | null {
  if (from.nodeType === Node.TEXT_NODE && (from as Text).data.length > 0)
    return from as Text;
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  walker.currentNode = from;
  let next = walker.nextNode() as Text | null;
  while (next && next.data.length === 0)
    next = walker.nextNode() as Text | null;
  return next;
}

// Resolve column `col` of `lineEl`'s text to the (node, offset) the DOM speaks.
// Walks the line's text nodes to find the one that contains the column; falls
// back to the element itself (an empty line rendered as a lone <br>) so a caret
// still lands somewhere focusable.
function domPointAt(
  lineEl: HTMLElement,
  col: number,
): {
  node: Node;
  offset: number;
} {
  const walker = lineEl.ownerDocument.createTreeWalker(
    lineEl,
    NodeFilter.SHOW_TEXT,
  );
  let remaining = col;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.data.length;
    if (remaining <= len) return { node, offset: remaining };
    remaining -= len;
    node = walker.nextNode() as Text | null;
  }
  // Past the end of all text (or no text at all): land at the line's end.
  const last = lastTextNode(lineEl);
  return last
    ? { node: last, offset: last.data.length }
    : { node: lineEl, offset: 0 };
}

/** A soft-wrapped line's visual row, as the source columns it spans. */
export type VisualRow = { start: number; end: number };

// How far apart two characters' rects may sit and still count as the same
// visual row. Sub-pixel layout jitter is the only difference expected within a
// row; the row below is a whole line-height away.
const ROW_EPSILON = 1;

/**
 * The **visual row** `col` sits in, as `[start, end)` source columns — the row
 * a soft wrap drew, not the source line, which may be many screens tall.
 *
 * This is what lets a vertical caret move land where the eye expects on a
 * wrapped line: a column is only meaningful relative to the row it is counted
 * from, and stepping up into a line arrives on its *last* row (see the goal
 * column in `MarkdownEditor.tsx`).
 *
 * Answers `{ start: 0, end: length }` — the whole line as a single row — when
 * the line doesn't wrap, and equally when the engine reports no geometry for it
 * (a headless test, a line not laid out yet). Callers then behave as they did
 * before wrapping was considered at all, rather than acting on a wrong row.
 */
export function visualRowAt(lineEl: HTMLElement, col: number): VisualRow {
  const len = (lineEl.textContent ?? "").length;
  const whole = { start: 0, end: len };
  if (len === 0) return whole;
  const top = charTop(lineEl, Math.max(0, Math.min(col, len - 1)));
  if (top === null) return whole;
  const start = rowEdge(lineEl, len, top, true);
  const last = rowEdge(lineEl, len, top, false);
  if (start === null || last === null) return whole;
  // `last` is the row's final *character*; the caret column past it is the
  // row's end, which is where a goal column longer than the row settles.
  return { start, end: last + 1 };
}

// The first (`first`) or last character index sharing `top`'s visual row.
// `charTop` never decreases across a line — a character is on the same row as
// the one before it or on a later one — so each edge is a binary search away,
// which keeps this off the O(n) rect-per-character path a long line would make
// expensive. Null the moment a measurement comes back without geometry: a
// half-measured line is worse than treating it as un-wrapped.
function rowEdge(
  lineEl: HTMLElement,
  len: number,
  top: number,
  first: boolean,
): number | null {
  let lo = 0;
  let hi = len - 1;
  let best: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const t = charTop(lineEl, mid);
    if (t === null) return null;
    const onRow = first ? t >= top - ROW_EPSILON : t <= top + ROW_EPSILON;
    if (onRow) {
      best = mid;
      if (first) hi = mid - 1;
      else lo = mid + 1;
    } else if (first) lo = mid + 1;
    else hi = mid - 1;
  }
  return best;
}

// The top of the character at `index`, or null when the engine reports no
// geometry for it. One character rather than a collapsed caret, for the reason
// `firstCharRect` gives: a range with something in it is what every engine
// measures, and a single character can only occupy one row.
function charTop(lineEl: HTMLElement, index: number): number | null {
  const a = domPointAt(lineEl, index);
  const b = domPointAt(lineEl, index + 1);
  const range = lineEl.ownerDocument.createRange();
  try {
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
  } catch {
    return null;
  }
  const rects = range.getClientRects?.();
  const rect =
    rects && rects.length > 0 ? rects[0]! : range.getBoundingClientRect?.();
  return rect && rect.height > 0 ? rect.top : null;
}

/** Place a collapsed caret `col` characters into `lineEl`'s text. */
export function placeCaret(lineEl: HTMLElement, col: number): void {
  placeRange(lineEl, col, col);
}

/**
 * Select `[from, to)` of `lineEl`'s text — the ranged sibling of
 * {@link placeCaret}, used when an edit wants to hand a span back selected
 * (the toolbar wrapping a word in `**`, or landing on a link's `url`
 * placeholder ready to be typed over) rather than just a caret.
 */
export function placeRange(
  lineEl: HTMLElement,
  from: number,
  to: number,
): void {
  const doc = lineEl.ownerDocument;
  const a = domPointAt(lineEl, from);
  const b = to === from ? a : domPointAt(lineEl, to);
  const range = doc.createRange();
  range.setStart(a.node, a.offset);
  try {
    range.setEnd(b.node, b.offset);
  } catch {
    range.collapse(true);
  }
  const sel = doc.defaultView?.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Re-assert the collapsed caret exactly where it already sits, so the engine
 * measures it against the layout as it *now* stands. Answers whether there was
 * a caret in `lineEl` to re-assert.
 *
 * The caret is placed from a layout effect — the instant after React has
 * rewritten the line's text, and so before the browser has laid the new text
 * out. Most engines re-measure the caret when that layout lands; WebKit keeps
 * painting it at the rect it took when the selection was set. Holding the
 * eraser down is what makes that visible: every repeat re-places the caret
 * against a layout one edit stale, and the caret is drawn a row or two away
 * from the text actually being erased while the erasing itself stays exactly
 * where the source says it is. Re-setting the same selection a frame later —
 * once layout has settled — makes the engine take the caret's rect again.
 *
 * A no-op unless the selection is still a collapsed caret inside `lineEl`: a
 * user who has since drawn a selection, or moved to another line, owns the
 * selection and must not have it dragged back. Re-setting is otherwise
 * invisible — it is the same range, so nothing about the caret's *position*
 * changes, only when it was last measured.
 */
export function resyncCaret(lineEl: HTMLElement): boolean {
  const sel = lineEl.ownerDocument.defaultView?.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (!lineEl.contains(range.startContainer)) return false;
  // A clone, because the live range is the selection's own: removing it can
  // leave the original collapsed to the document start on some engines.
  const same = range.cloneRange();
  sel.removeAllRanges();
  sel.addRange(same);
  return true;
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
