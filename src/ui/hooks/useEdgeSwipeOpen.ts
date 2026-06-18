import { useEffect, useRef } from "react";

import type { MenuButtonSide } from "../sideMenuPosition.ts";

// Touch-driven "swipe in from the screen edge to open the drawer" gesture,
// the replacement for the floating menu button when the user hides it (the
// Show-menu-button toggle on the General settings tab). A document-level
// touch listener, gated by an `enabled` flag, that fires once a deliberate
// gesture completes.
//
// A press that starts within `EDGE_ZONE` of the relevant border and then
// travels inward (rightward from the left edge, leftward from the right
// edge) past `OPEN_DISTANCE` — while staying more horizontal than vertical,
// so it doesn't fight a scroll — calls `onOpen`. The edge it watches is the
// drawer's resting side, so the gesture always pulls the panel in from where
// it lives.
//
// Touch-only by design: an edge swipe is a phone gesture, and the toggle
// that enables it is only offered in the installed PWA, where the browser's
// own back-swipe isn't competing for the same edge.

// How close to the border (px) a touch must start to count as an edge swipe.
const EDGE_ZONE = 30;
// Inward travel (px) the finger must cover before the drawer opens.
const OPEN_DISTANCE = 48;

type Options = {
  /** The edge to watch — the drawer's resting side. */
  side: MenuButtonSide;
  /** When false the listener is mounted but no-ops. */
  enabled: boolean;
  /** Called once when a completed edge swipe is recognised. */
  onOpen: () => void;
};

function hasOpenModal(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

export function useEdgeSwipeOpen({ side, enabled, onOpen }: Options): void {
  // Mirror the live inputs into a ref so the document listeners can be
  // attached once and read the latest values without re-subscribing on every
  // render (the drawer's side / enabled flag changes independently).
  const cfg = useRef({ side, enabled, onOpen });
  cfg.current = { side, enabled, onOpen };

  useEffect(() => {
    const start = { x: 0, y: 0, armed: false, fired: false };

    const onTouchStart = (e: TouchEvent) => {
      start.armed = false;
      start.fired = false;
      if (!cfg.current.enabled) return;
      if (e.touches.length !== 1) return;
      if (hasOpenModal()) return;
      const touch = e.touches[0];
      if (!touch) return;
      const fromLeft = touch.clientX <= EDGE_ZONE;
      const fromRight = touch.clientX >= window.innerWidth - EDGE_ZONE;
      const onWatchedEdge = cfg.current.side === "left" ? fromLeft : fromRight;
      if (!onWatchedEdge) return;
      start.x = touch.clientX;
      start.y = touch.clientY;
      start.armed = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!start.armed || start.fired) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      // A mostly-vertical drag is a scroll, not an open — bail and let it be.
      if (Math.abs(dy) > Math.abs(dx)) {
        start.armed = false;
        return;
      }
      const inward = cfg.current.side === "left" ? dx : -dx;
      if (inward < OPEN_DISTANCE) return;
      start.fired = true;
      start.armed = false;
      if (e.cancelable) e.preventDefault();
      cfg.current.onOpen();
    };

    const onTouchEnd = () => {
      start.armed = false;
      start.fired = false;
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    // Non-passive so the inward swipe can be claimed from any native gesture.
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
