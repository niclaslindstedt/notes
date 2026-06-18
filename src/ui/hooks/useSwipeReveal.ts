// Left-swipe-to-reveal for side-menu rows. Latches the foreground open past
// a small threshold to uncover a single trailing action (a trash button);
// nothing fires on its own — the revealed button is the only way to act, so
// a swipe never removes anything by itself.
//
// The caller spreads `handlers` onto the sliding foreground element and
// applies `translateX(offset)`, with `animating` gating the CSS
// transition. `actionWidth` is how far the row latches open and must match
// the width of the action rendered behind the foreground.

import { useCallback, useRef, useState, type PointerEvent } from "react";

// Movement before we commit to a horizontal vs. vertical gesture (so a
// vertical drag still scrolls the drawer instead of arming the swipe).
const AXIS_LOCK = 8;

export interface SwipeReveal {
  offset: number;
  animating: boolean;
  open: boolean;
  close: () => void;
  handlers: {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
    onClickCapture: (e: React.MouseEvent) => void;
  };
}

export function useSwipeReveal(actionWidth: number): SwipeReveal {
  // Latch open once the swipe passes the halfway point of the action strip.
  const openAt = actionWidth / 2;

  const [offset, setOffset] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [open, setOpen] = useState(false);

  const startX = useRef(0);
  const startY = useRef(0);
  const axis = useRef<"none" | "h" | "v">("none");
  const dx = useRef(0);
  const dragged = useRef(false);
  const wasOpen = useRef(false);
  const pointerId = useRef<number | null>(null);

  const close = useCallback(() => {
    setAnimating(true);
    setOffset(0);
    setOpen(false);
  }, []);

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pointerId.current = e.pointerId;
      startX.current = e.clientX;
      startY.current = e.clientY;
      axis.current = "none";
      dx.current = 0;
      dragged.current = false;
      wasOpen.current = open;
      setAnimating(false);
    },
    [open],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (pointerId.current !== e.pointerId) return;
      const mx = e.clientX - startX.current;
      const my = e.clientY - startY.current;
      if (axis.current === "none") {
        if (Math.abs(mx) < AXIS_LOCK && Math.abs(my) < AXIS_LOCK) return;
        axis.current = Math.abs(mx) > Math.abs(my) ? "h" : "v";
        if (axis.current === "h")
          e.currentTarget.setPointerCapture(e.pointerId);
      }
      if (axis.current !== "h") return;
      e.preventDefault();
      dragged.current = true;
      let next = (wasOpen.current ? -actionWidth : 0) + mx;
      // Closed is the rightmost extent (there is no right-swipe action);
      // rubber-band past the open extent so it feels bounded.
      if (next > 0) next = 0;
      if (next < -actionWidth) next = -actionWidth + (next + actionWidth) * 0.3;
      dx.current = next;
      setOffset(next);
    },
    [actionWidth],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (pointerId.current !== e.pointerId) return;
      pointerId.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
      if (axis.current !== "h") {
        axis.current = "none";
        return;
      }
      axis.current = "none";
      const traveled = dx.current;
      setAnimating(true);
      if (traveled <= -openAt) {
        setOpen(true);
        setOffset(-actionWidth);
        return;
      }
      setOpen(false);
      setOffset(0);
    },
    [openAt, actionWidth],
  );

  // Swallow the click that trails a drag (so a swipe never activates the
  // row), and turn a tap on an already-open row into a close.
  const onClickCapture = useCallback(
    (e: React.MouseEvent) => {
      if (dragged.current) {
        e.preventDefault();
        e.stopPropagation();
        dragged.current = false;
        return;
      }
      if (wasOpen.current && open) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    },
    [open, close],
  );

  return {
    offset,
    animating,
    open,
    close,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onClickCapture,
    },
  };
}
