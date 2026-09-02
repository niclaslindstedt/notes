// The screen-edge zone the side menu's own gestures own, and the guard that
// keeps row swipes out of it.
//
// An inward swipe that starts at a screen border belongs to the drawer
// (`useEdgeSwipeOpen`), but the finger still lands on whatever the page is
// painting there — a note card in the overview, a note row in the open
// drawer. Those rows carry their own pointer-driven swipe (`useRowSwipe` /
// `useSwipeReveal`), and a row only swallows the trailing click once its own
// gesture has committed to a *horizontal* drag. An edge swipe that arcs
// downward as it comes in locks the row's axis to "vertical", so the row
// treats the whole thing as a scroll and the browser's synthesized click at
// the end activates it — the drawer opens and a note opens behind it.
//
// So the edge zone is reserved: a touch gesture that starts within
// `EDGE_ZONE` of a border never arms the row it started over, and the click
// that trails it is swallowed unless the finger stayed put (a genuine tap at
// the edge still opens the row it hit).

import { useCallback, useRef, type MouseEvent, type PointerEvent } from "react";

// How close to a screen border (px) a gesture must start to count as an edge
// gesture. Passed to `useEdgeSwipeOpen` so it and the row guard below agree on
// where the edge is.
export const EDGE_ZONE = 30;

// Movement (px) that separates a tap from a swipe. Below this the gesture is
// a tap on the row and is left alone; at or above it the click is swallowed.
const TAP_SLOP = 8;

/** Does a gesture starting at `clientX` begin in either screen-edge zone? */
export function startsAtScreenEdge(clientX: number): boolean {
  const width = typeof window === "undefined" ? 0 : window.innerWidth;
  return clientX <= EDGE_ZONE || clientX >= width - EDGE_ZONE;
}

/** The pointer/click handler set a swipe hook spreads onto its row. */
export interface SwipeGestureHandlers {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
  onClickCapture: (e: MouseEvent<Element>) => void;
}

/**
 * Wraps a row swipe's handlers so a touch gesture that begins in the screen's
 * edge zone never reaches them: the row doesn't arm, doesn't slide, and
 * doesn't fire its action, and the click the browser synthesizes at the end
 * is swallowed once the finger has travelled past `TAP_SLOP`.
 *
 * Mouse gestures pass straight through — a pointer has no edge-swipe to
 * confuse, and a narrow window would otherwise leave a dead strip of
 * unclickable rows.
 */
export function useEdgeGestureGuard(
  handlers: SwipeGestureHandlers,
): SwipeGestureHandlers {
  // The gesture in flight started at a screen edge, so the row stays out of
  // it. `moved` tracks whether it was a swipe (swallow the trailing click) or
  // a stationary tap (let it through).
  const guarding = useRef(false);
  const moved = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const swallowClick = useRef(false);

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      // A guarded swipe often ends with no click at all (the drawer took the
      // gesture), so clear the previous verdict here rather than trusting a
      // click to consume it — a stale `true` would eat the next real tap.
      swallowClick.current = false;
      guarding.current =
        e.pointerType !== "mouse" && startsAtScreenEdge(e.clientX);
      if (!guarding.current) {
        handlers.onPointerDown(e);
        return;
      }
      moved.current = false;
      start.current = { x: e.clientX, y: e.clientY };
    },
    [handlers],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (!guarding.current) {
        handlers.onPointerMove(e);
        return;
      }
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;
      if (Math.abs(dx) >= TAP_SLOP || Math.abs(dy) >= TAP_SLOP)
        moved.current = true;
    },
    [handlers],
  );

  const end = useCallback(
    (
      e: PointerEvent<HTMLElement>,
      delegate: SwipeGestureHandlers["onPointerUp"],
    ) => {
      if (!guarding.current) {
        delegate(e);
        return;
      }
      guarding.current = false;
      // The click lands after pointerup, so carry the verdict across.
      swallowClick.current = moved.current;
    },
    [],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLElement>) => end(e, handlers.onPointerUp),
    [end, handlers],
  );

  const onPointerCancel = useCallback(
    (e: PointerEvent<HTMLElement>) => end(e, handlers.onPointerCancel),
    [end, handlers],
  );

  const onClickCapture = useCallback(
    (e: MouseEvent<Element>) => {
      if (swallowClick.current) {
        swallowClick.current = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      handlers.onClickCapture(e);
    },
    [handlers],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClickCapture,
  };
}
