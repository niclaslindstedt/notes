// Swipe-to-close for the navigation drawer. The drawer opens from its resting
// edge (the floating button or the edge swipe); this lets the same gesture
// reverse it — drag the panel back toward that edge and, past a threshold or
// on a flick, it flies the rest of the way out and unmounts. A drag that
// doesn't reach the threshold snaps back open. Closing this way *follows the
// finger*, where a backdrop tap (handled separately) is an instant dismiss.
//
// The caller spreads `handlers` onto the drawer panel and applies
// `translateX(offset)`; `progress` (1 = fully open) dims the backdrop in step
// with the drag. `animating` gates the settle transition.
//
// Pointer-based and axis-locked like `useSwipeReveal`: a vertical drag stays a
// scroll of the panel, only a horizontal one engages the close. A row that
// carries its own left-swipe-to-reveal (tagged `[data-drawer-swipe-ignore]`)
// keeps its gesture — the close stands down when the drag starts on one.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type TransitionEvent,
} from "react";

import type { MenuButtonSide } from "../sideMenuPosition.ts";

// Movement before we commit to a horizontal vs. vertical gesture (so a
// vertical drag still scrolls the drawer instead of arming the close).
const AXIS_LOCK = 8;
// Fraction of the panel width the drag must cover for release to commit the
// close; short of it the panel snaps back open.
const CLOSE_FRACTION = 0.4;
// A quick flick toward the resting edge (px/ms) closes regardless of distance.
const FLICK_VELOCITY = 0.45;

export interface DrawerSwipeClose {
  /** Signed px the panel is translated from its open position (toward the
   *  resting edge: negative for a left drawer, positive for a right one). */
  offset: number;
  /** 1 = fully open, 0 = fully closed — drives the backdrop dim. */
  progress: number;
  /** Whether the settle (snap-back / fly-out) transition should animate. */
  animating: boolean;
  handlers: {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
    onTransitionEnd: (e: TransitionEvent<HTMLElement>) => void;
  };
}

export function useDrawerSwipeClose(
  side: MenuButtonSide,
  open: boolean,
  onClose: () => void,
): DrawerSwipeClose {
  const [offset, setOffset] = useState(0);
  const [animating, setAnimating] = useState(false);

  const startX = useRef(0);
  const startY = useRef(0);
  const axis = useRef<"none" | "h" | "v">("none");
  const width = useRef(0);
  const pointerId = useRef<number | null>(null);
  // The drag started on a row that owns horizontal swipes — leave it alone.
  const ignore = useRef(false);
  const lastX = useRef(0);
  const lastT = useRef(0);
  const velocity = useRef(0);
  // The fly-out is in flight; commit the close when its transition ends.
  const closing = useRef(false);

  // The hook outlives any single open (SideMenu stays mounted), so clear the
  // leftover closed offset when the drawer opens again — otherwise it would
  // mount translated off-screen.
  useEffect(() => {
    if (!open) return;
    closing.current = false;
    setAnimating(false);
    setOffset(0);
  }, [open]);

  const clamp = useCallback(
    (mx: number) =>
      side === "left"
        ? Math.min(0, Math.max(-width.current, mx))
        : Math.max(0, Math.min(width.current, mx)),
    [side],
  );

  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const target = e.target as Element | null;
    ignore.current = target?.closest("[data-drawer-swipe-ignore]") != null;
    pointerId.current = e.pointerId;
    startX.current = e.clientX;
    startY.current = e.clientY;
    lastX.current = e.clientX;
    lastT.current = e.timeStamp;
    velocity.current = 0;
    axis.current = "none";
    width.current = e.currentTarget.offsetWidth || 1;
    closing.current = false;
    setAnimating(false);
  }, []);

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (pointerId.current !== e.pointerId || ignore.current) return;
      const mx = e.clientX - startX.current;
      const my = e.clientY - startY.current;
      if (axis.current === "none") {
        if (Math.abs(mx) < AXIS_LOCK && Math.abs(my) < AXIS_LOCK) return;
        axis.current = Math.abs(mx) > Math.abs(my) ? "h" : "v";
        if (axis.current === "h") e.currentTarget.setPointerCapture(e.pointerId);
      }
      if (axis.current !== "h") return;
      e.preventDefault();
      const dt = e.timeStamp - lastT.current;
      if (dt > 0) velocity.current = (e.clientX - lastX.current) / dt;
      lastX.current = e.clientX;
      lastT.current = e.timeStamp;
      setOffset(clamp(mx));
    },
    [clamp],
  );

  const settle = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (pointerId.current !== e.pointerId) return;
      pointerId.current = null;
      if (e.currentTarget.hasPointerCapture?.(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
      const wasHorizontal = axis.current === "h" && !ignore.current;
      axis.current = "none";
      ignore.current = false;
      if (!wasHorizontal) return;
      const w = width.current || 1;
      // Travel toward the closed edge, always >= 0.
      const traveled = side === "left" ? -offset : offset;
      const flick =
        side === "left"
          ? velocity.current < -FLICK_VELOCITY
          : velocity.current > FLICK_VELOCITY;
      setAnimating(true);
      if (traveled >= w * CLOSE_FRACTION || flick) {
        closing.current = true;
        setOffset(side === "left" ? -w : w);
      } else {
        setOffset(0);
      }
    },
    [offset, side],
  );

  const onTransitionEnd = useCallback(
    (e: TransitionEvent<HTMLElement>) => {
      // Only the fly-out's own transform settle commits the close; ignore the
      // snap-back and any bubbled child transition.
      if (e.propertyName !== "transform" || !closing.current) return;
      closing.current = false;
      onClose();
    },
    [onClose],
  );

  const progress =
    width.current > 0 ? 1 - Math.abs(offset) / width.current : 1;

  return {
    offset,
    progress,
    animating,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: settle,
      onPointerCancel: settle,
      onTransitionEnd,
    },
  };
}
