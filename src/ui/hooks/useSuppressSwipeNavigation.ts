import { useEffect } from "react";

// Suppresses the browser's native edge-swipe history navigation — the
// "swipe in from the left edge to go *back*" (and its mirror, swipe in from
// the right edge to go *forward*) gesture phones fire on a horizontal drag
// that starts at a screen border.
//
// On notes that gesture lives on the same edges as the side menu's own swipes
// — the edge-swipe-to-open, the drawer-swipe-to-close, and the row
// swipe-to-reveal/archive — so a horizontal drag near a border yanked the page
// out from under the drawer mid-swipe. `overscroll-behavior` (set on `html`)
// tames Chrome's overscroll navigation but has no effect on iOS Safari's
// edge-back gesture, so this is the belt to that suspenders: a document-level,
// non-passive `touchmove` guard that calls `preventDefault` once a single-touch
// drag starting within `EDGE_ZONE` of a border proves horizontal, cancelling
// the native navigation while leaving the app's own pointer-driven swipe
// gestures (a separate event stream) untouched.
//
// It only claims gestures that *begin* at the very edge, so horizontal scrolls
// inside the page (a wide code block, a carousel) are never touched.

// How close to a screen border (px) a touch must start to count as an edge
// swipe — matches `useEdgeSwipeOpen`'s zone.
const EDGE_ZONE = 30;
// Horizontal travel (px) before we commit the gesture to "navigation" and
// claim it. Small, so the native swipe is cancelled before it animates.
const AXIS_LOCK = 10;

export function useSuppressSwipeNavigation(): void {
  useEffect(() => {
    const start = { x: 0, y: 0, atEdge: false, decided: false };

    const onTouchStart = (e: TouchEvent) => {
      start.atEdge = false;
      start.decided = false;
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      if (!touch) return;
      const fromLeft = touch.clientX <= EDGE_ZONE;
      const fromRight = touch.clientX >= window.innerWidth - EDGE_ZONE;
      if (!fromLeft && !fromRight) return;
      start.x = touch.clientX;
      start.y = touch.clientY;
      start.atEdge = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!start.atEdge || start.decided) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
      // A mostly-vertical drag is a scroll — let it be.
      if (Math.abs(dy) > Math.abs(dx)) {
        start.atEdge = false;
        return;
      }
      // A horizontal drag from the edge is the native back/forward swipe —
      // cancel it. The app's own gestures ride pointer events and keep working.
      start.decided = true;
      if (e.cancelable) e.preventDefault();
    };

    const onTouchEnd = () => {
      start.atEdge = false;
      start.decided = false;
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
