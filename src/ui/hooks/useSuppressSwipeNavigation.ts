import { useEffect } from "react";

// Suppresses the browser's native swipe history navigation — the "drag right to
// go *back*" (and its mirror, drag left to go *forward*) gesture phones fire on
// a horizontal swipe.
//
// On notes that gesture collides with the app's own horizontal swipes at every
// turn — the side menu's edge-swipe-to-open and drawer-swipe-to-close, the note
// card's swipe-to-archive, the sidebar row's swipe-to-reveal — so a horizontal
// drag yanked the page out from under the gesture mid-swipe.
// `overscroll-behavior` (set on `html`) tames Chrome's overscroll navigation
// but has no effect on iOS Safari's edge-back gesture, so this is the belt to
// that suspenders: a document-level, non-passive `touchmove` guard that calls
// `preventDefault` once a single-touch drag proves horizontal, cancelling the
// native navigation while leaving the app's own pointer-driven swipe gestures
// (a separate event stream) untouched.
//
// Two things about *which* drags it claims are load-bearing:
//
//   * **Anywhere, not just at the screen edge.** iOS starts its interactive
//     back transition from a band wider than the 30px the side menu calls the
//     edge, and Chrome's overscroll navigation doesn't need an edge at all — so
//     an edge-only guard let a swipe that began an inch in navigate the page
//     away regardless.
//   * **A drag stays undecided until one axis actually wins.** The guard used
//     to write a gesture off as a scroll the moment its first few pixels
//     leaned vertical, which is exactly the shape of a swipe that arcs
//     downward as it sets off: it was disarmed before it ever turned
//     horizontal, and the native navigation ran.
//
// It stands down inside anything that scrolls sideways (a wide code block, the
// editor with word wrap off, the header's action rail), which is what keeps a
// real horizontal scroll a scroll.

// Travel (px) on one axis before the gesture is committed to that axis. Small,
// so the native swipe is cancelled before it animates.
const AXIS_LOCK = 8;

/**
 * Whether the gesture began inside an element that can scroll sideways. Those
 * own their horizontal drags — and already carry `overscroll-x` containment, so
 * a drag that runs off their end doesn't chain out to the browser either.
 */
function insideHorizontalScroller(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null;
  for (; el; el = el.parentElement) {
    if (el.scrollWidth <= el.clientWidth) continue;
    const overflowX = getComputedStyle(el).overflowX;
    if (overflowX === "auto" || overflowX === "scroll") return true;
  }
  return false;
}

export function useSuppressSwipeNavigation(): void {
  useEffect(() => {
    const start = { x: 0, y: 0, tracking: false, claimed: false };

    const onTouchStart = (e: TouchEvent) => {
      start.tracking = false;
      start.claimed = false;
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      if (!touch) return;
      if (insideHorizontalScroller(e.target)) return;
      start.x = touch.clientX;
      start.y = touch.clientY;
      start.tracking = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!start.tracking) return;
      if (!start.claimed) {
        const touch = e.touches[0];
        if (!touch) return;
        const dx = Math.abs(touch.clientX - start.x);
        const dy = Math.abs(touch.clientY - start.y);
        // Neither axis has won yet: keep watching rather than deciding off the
        // first wobble (see the note about arcing swipes above).
        if (dx < AXIS_LOCK && dy < AXIS_LOCK) return;
        if (dy >= dx) {
          // A scroll, and it stays one for the rest of the gesture.
          start.tracking = false;
          return;
        }
        start.claimed = true;
      }
      // Every move of a claimed gesture is cancelled, not just the one that
      // decided it: one `preventDefault` is enough on paper, but a browser only
      // stays stood down while the page keeps saying so.
      if (e.cancelable) e.preventDefault();
    };

    const onTouchEnd = () => {
      start.tracking = false;
      start.claimed = false;
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    // Non-passive so the horizontal swipe can be claimed from the browser.
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("touchcancel", onTouchEnd);
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);
}
