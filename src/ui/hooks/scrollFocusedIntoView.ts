// Bring a freshly-focused field or tapped line into view *after* the soft
// keyboard has taken its space — by scrolling the element's own scroll
// container, never the window.
//
// On mobile the browser runs its native "reveal the focused field" pass at
// focus time — before the on-screen keyboard finishes animating in and
// shrinking the visual viewport. A field that sits low inside a
// `position: fixed` modal (the encryption passphrase at the bottom of
// Settings → Storage) or a line tapped in the lower half of the editor is
// still fully visible at that instant, so nothing scrolls; the keyboard then
// slides up and covers it. The app shell is sized to the *visual* viewport
// (`--app-height`), so its scroll containers already end at the keyboard's top
// once it settles — we just have to re-scroll the target into that shrunk band.
//
// Why we scroll the container by hand instead of `el.scrollIntoView`:
// `Element.scrollIntoView` walks up *every* scrollable ancestor and, on iOS,
// nudges the visual viewport as well. With the shell pinned to the visual
// viewport, that bubbling drags the target *past the top of its scroll
// container* — a line tapped near the top of a note is flung above the sticky
// header and off screen, caret and all. Scrolling only the nearest scrollable
// ancestor's `scrollTop` keeps the motion contained: the target is centred in
// the visible band, and an edge element (the first / last line) simply clamps
// to the top / bottom of that band instead of being thrown out of it. When no
// scrollable ancestor exists (nothing to scroll, so the target already fits the
// band) we fall back to the browser's own reveal.
//
// The keyboard doesn't arrive in one step. iOS animates it in and emits a
// *burst* of `resize` (and `scroll`) events on the visual viewport as it
// settles, each reporting an intermediate height. Revealing on only the first
// one centres the target against a viewport that is still shrinking, so the
// last line — which can't scroll any further up once the container clamps —
// slides back behind the keyboard as the remaining events land, and nothing
// scrolls it clear again. Re-run the reveal on *every* event until the viewport
// has been quiet for a beat, then stop listening (so a later user scroll never
// yanks the view). A timeout backstops platforms that fire no event (desktop
// focus, or a focus that opens no keyboard — where the element is already on
// screen and centring is harmless).
//
// The reveal glides rather than snaps: each event re-issues a `smooth`
// `scrollTo`, and the browser retargets the in-flight animation, so the burst
// reads as one continuous motion that lands on the final centred position
// rather than a jump. Users who ask for reduced motion get the instant jump
// instead.

// The `scrollTop` that centres an element within its scroll container, clamped
// to the container's scroll range so an element near an edge rests at the band's
// top / bottom rather than being pushed past it. Pure so the geometry is unit-
// testable without a layout engine (jsdom does no layout).
export function centeredScrollTop(
  elTop: number,
  elHeight: number,
  viewTop: number,
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): number {
  // Where the element sits within the scroller's scrolled content.
  const offsetInContent = elTop - viewTop + scrollTop;
  const centered = offsetInContent - (clientHeight - elHeight) / 2;
  const max = Math.max(0, scrollHeight - clientHeight);
  return Math.max(0, Math.min(centered, max));
}

// The `scrollTop` that keeps a line clear of its scroll container's top and
// bottom edges by a `buffer` gap (typically one line height), so the caret
// never rests against — or slips past — either edge. Returns the current
// `scrollTop` unchanged when the line already sits inside the buffered band (so
// ordinary mid-note typing never moves the view), and clamps to the scroll
// range at the extremes. Pure so the geometry is unit-testable without a layout
// engine (jsdom does no layout).
export function bufferedScrollTop(
  elTop: number,
  elHeight: number,
  viewTop: number,
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  buffer: number,
): number {
  const topInContent = elTop - viewTop + scrollTop;
  const bottomInContent = topInContent + elHeight;
  const max = Math.max(0, scrollHeight - clientHeight);
  // Below the buffered band's foot (pressing Enter at the bottom) → pull the
  // content up so the buffer gap sits beneath the line.
  if (bottomInContent + buffer > scrollTop + clientHeight)
    return Math.max(0, Math.min(bottomInContent + buffer - clientHeight, max));
  // Above the buffered band's head (a merge that hoists the caret up) → push the
  // content down so the buffer gap sits above the line.
  if (topInContent - buffer < scrollTop)
    return Math.max(0, Math.min(topInContent - buffer, max));
  return scrollTop;
}

// The nearest ancestor that can actually scroll vertically, or null when the
// content fits (nothing to scroll). Walks up from the element's parent.
function nearestScrollableAncestor(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    )
      return node;
    node = node.parentElement;
  }
  return null;
}

// `ifHidden` restores-scroll-friendly mode: only scroll when the target is
// actually outside the visible band, leaving an already-visible element (and
// any scroll position just restored around it) exactly where it is. Used when
// reopening a note at a remembered scroll offset — the caret is only nudged if
// the soft keyboard ends up covering it, never re-centred when it's already in
// view.
export function scrollFocusedIntoView(
  el: HTMLElement,
  opts: { ifHidden?: boolean } = {},
): void {
  const { ifHidden = false } = opts;
  const reduceMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const behavior: ScrollBehavior = reduceMotion ? "auto" : "smooth";
  const reveal = () => {
    if (!el.isConnected) return;
    const scroller = nearestScrollableAncestor(el);
    if (!scroller) {
      // Nothing scrollable around it — the target already fits the band. In
      // ifHidden mode that means it's on screen, so leave it; otherwise defer
      // to the browser's own reveal rather than doing nothing.
      if (ifHidden) return;
      el.scrollIntoView({ block: "center", behavior });
      return;
    }
    const elRect = el.getBoundingClientRect();
    const viewRect = scroller.getBoundingClientRect();
    // Already fully within the visible band: preserve the current scroll.
    if (
      ifHidden &&
      elRect.top >= viewRect.top &&
      elRect.bottom <= viewRect.bottom
    )
      return;
    const top = centeredScrollTop(
      elRect.top,
      elRect.height,
      viewRect.top,
      scroller.scrollTop,
      scroller.clientHeight,
      scroller.scrollHeight,
    );
    scroller.scrollTo({ top, behavior });
  };

  const vv = window.visualViewport;
  if (!vv) {
    reveal();
    return;
  }

  let sawEvent = false;
  let quietTimer = 0;
  const stop = () => {
    window.clearTimeout(quietTimer);
    vv.removeEventListener("resize", onChange);
    vv.removeEventListener("scroll", onChange);
  };
  const onChange = () => {
    sawEvent = true;
    reveal();
    // Once the settling burst goes quiet, tear down so a later user scroll of
    // the same viewport doesn't re-centre the line under them.
    window.clearTimeout(quietTimer);
    quietTimer = window.setTimeout(stop, 250);
  };
  vv.addEventListener("resize", onChange);
  vv.addEventListener("scroll", onChange);
  // If the keyboard never moved the viewport, reveal once and stop; if it did,
  // the quiet-timer above already owns teardown, so leave the burst alone.
  window.setTimeout(() => {
    if (sawEvent) return;
    reveal();
    stop();
  }, 350);
}
