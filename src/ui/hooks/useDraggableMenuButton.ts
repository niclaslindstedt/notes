import { useCallback, useEffect, useRef, useState } from "react";

import {
  clampRect,
  MENU_BUTTON_MARGIN,
  MENU_BUTTON_SIZE,
  rectToPosition,
  restingRect,
  type MenuButtonPosition,
} from "../sideMenuPosition.ts";

// Pointer-driven dragging for the floating navigation button. The button
// follows the finger / cursor 1:1 while dragging, then snaps to the nearer
// edge on release (the glide back is a CSS transition `SideMenu` toggles
// off while a drag is live). A press that never travels past
// `DRAG_THRESHOLD` is treated as a tap and left for the button's own click
// handler to toggle the drawer — so keyboard activation keeps working too.

const DRAG_THRESHOLD = 6;

type Rect = { left: number; top: number };

type Viewport = {
  vw: number;
  vh: number;
  offsetLeft: number;
  offsetTop: number;
};

// Prefer the visual viewport: on iOS the software keyboard shrinks (and can
// offset) it while leaving `window.innerWidth/innerHeight` at the full layout
// size. Since the button is `position: fixed` — laid out against this same
// client space — reading the visual viewport keeps the resting spot inside
// the area left above the keyboard and the drag clamp reachable. Falls back
// to the window box where the API is missing (older engines, jsdom).
function readViewport(): Viewport {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (vv) {
    return {
      vw: vv.width,
      vh: vv.height,
      offsetLeft: vv.offsetLeft,
      offsetTop: vv.offsetTop,
    };
  }
  return {
    vw: window.innerWidth,
    vh: window.innerHeight,
    offsetLeft: 0,
    offsetTop: 0,
  };
}

export interface DraggableMenuButton {
  /** Inline `left` / `top` for the fixed button — live while dragging. */
  style: { left: string; top: string };
  /** True while a real drag is in flight (used to suppress the transition). */
  dragging: boolean;
  handlers: {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => void;
  };
  /**
   * Returns true (and clears the flag) when the click that just fired was
   * the tail of a drag, so the caller can swallow it instead of toggling.
   */
  consumeDragClick: () => boolean;
}

export function useDraggableMenuButton(
  position: MenuButtonPosition,
  onPositionChange: (next: MenuButtonPosition) => void,
): DraggableMenuButton {
  const [viewport, setViewport] = useState<Viewport>(() =>
    typeof window === "undefined"
      ? { vw: 0, vh: 0, offsetLeft: 0, offsetTop: 0 }
      : readViewport(),
  );
  useEffect(() => {
    const onResize = () => setViewport(readViewport());
    window.addEventListener("resize", onResize);
    // The visual viewport fires its own resize / scroll as the keyboard
    // opens and closes (and on pinch-zoom); `window` resize alone misses
    // those on iOS, so the button would stay pinned to its full-height spot
    // behind the keyboard. Listening here re-normalizes it into the space
    // that's left.
    const vv = window.visualViewport;
    vv?.addEventListener("resize", onResize);
    vv?.addEventListener("scroll", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      vv?.removeEventListener("resize", onResize);
      vv?.removeEventListener("scroll", onResize);
    };
  }, []);

  // The live top-left while dragging; null when resting at `position`.
  const [dragRect, setDragRect] = useState<Rect | null>(null);
  // We track the drag as a pixel delta from the pointer-down point applied
  // to the button's known style top-left (`baseLeft` / `baseTop`), rather
  // than mapping the raw pointer coordinates into a position. `clientX` /
  // `getBoundingClientRect` are visual-viewport relative while a fixed
  // element's `style.top/left` are layout-viewport relative; on iOS those
  // differ by the visual viewport's offset, so reading an absolute position
  // would make the button jump by that offset the instant a drag began. A
  // delta only relies on the pointer moving 1:1, which holds in either space.
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseLeft: number;
    baseTop: number;
    moved: boolean;
  } | null>(null);
  // Set when a drag ends so the synthetic click can be ignored once.
  const draggedRef = useRef(false);

  const resting = restingRect(
    position,
    viewport.vw,
    viewport.vh,
    MENU_BUTTON_SIZE,
    MENU_BUTTON_MARGIN,
    viewport.offsetLeft,
    viewport.offsetTop,
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      draggedRef.current = false;
      drag.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        // Anchor to the position we're actually rendering, so the first
        // move continues from there with no jump.
        baseLeft: resting.left,
        baseTop: resting.top,
        moved: false,
      };
      // Capture so the drag keeps tracking even if the pointer outruns the
      // button (guarded — jsdom and very old engines lack the API).
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    [resting.left, resting.top],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const { vw, vh, offsetLeft, offsetTop } = readViewport();
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved) {
        if (Math.abs(dx) <= DRAG_THRESHOLD && Math.abs(dy) <= DRAG_THRESHOLD) {
          return;
        }
        d.moved = true;
        draggedRef.current = true;
      }
      setDragRect(
        clampRect(
          d.baseLeft + dx,
          d.baseTop + dy,
          vw,
          vh,
          MENU_BUTTON_SIZE,
          MENU_BUTTON_MARGIN,
          offsetLeft,
          offsetTop,
        ),
      );
    },
    [],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      drag.current = null;
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      }
      if (!d.moved) {
        setDragRect(null);
        return;
      }
      const { vw, vh, offsetLeft, offsetTop } = readViewport();
      const final = dragRect ?? resting;
      onPositionChange(
        rectToPosition(
          final.left,
          final.top,
          vw,
          vh,
          MENU_BUTTON_SIZE,
          MENU_BUTTON_MARGIN,
          offsetLeft,
          offsetTop,
        ),
      );
      setDragRect(null);
    },
    [dragRect, resting, onPositionChange],
  );

  const consumeDragClick = useCallback(() => {
    if (!draggedRef.current) return false;
    draggedRef.current = false;
    return true;
  }, []);

  const rect = dragRect ?? resting;
  return {
    style: { left: `${rect.left}px`, top: `${rect.top}px` },
    dragging: dragRect !== null,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
    consumeDragClick,
  };
}
