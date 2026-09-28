// Where a scroll area has to sit for one row in it to be comfortably on screen:
// the row itself plus `margin` pixels of context on either side — enough, when
// `margin` is a row's height, to show the row after it (and the one before it
// when scrolling up to it). Returns `null` when the row is already in view with
// that context, so a visible row never nudges the list.
//
// Positions are in the scroll area's content coordinates: `row.top` is measured
// from the top of the scrolled content, `view.top` is the current `scrollTop`.
// Nothing here clamps to the content height — the browser does that on assign,
// which is what lets the last row in the list ask for context below it that
// isn't there without special-casing it.
export function revealScrollTop(
  view: { top: number; height: number },
  row: { top: number; height: number },
  margin: number,
): number | null {
  const wantTop = row.top - margin;
  const wantBottom = row.top + row.height + margin;
  if (wantTop >= view.top && wantBottom <= view.top + view.height) return null;
  // Below the fold: bring its bottom (and the context after it) up to the
  // bottom edge. If the row and its context don't fit at all, the row's own
  // top wins so it is never cut off.
  if (wantBottom > view.top + view.height)
    return Math.max(0, Math.min(wantBottom - view.height, row.top));
  return Math.max(0, wantTop);
}
