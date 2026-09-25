import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import {
  DismissBackdrop,
  computeFloatingRect,
  forgetSafeArea,
  insetViewport,
  readEdgeInsets,
  type FloatingPlacement,
  type FloatingPoint,
} from "@niclaslindstedt/oss-framework/components";
import { useEscapeKey } from "./hooks/useEscapeKey.ts";

// Portalled dropdown / popover shell (float position, Escape + outside-click
// dismissal) — every dropdown in the app opens through this one. The chrome
// (backdrop, width, horizontal clamping) is the framework's; the *vertical*
// decision is ours, for two reasons.
//
// **Dropdowns drop down.** The framework flips a panel above its trigger
// whenever less than ~180px of viewport is left below it, however short the
// panel is. With the phone's soft keyboard up that is nearly always, and it is
// never what anyone wants: the menu covers the trigger it came from, and for a
// trigger near the top of the screen (the styling toolbar, under the editor
// header) it runs off the top edge. Here a panel opens below unless its
// content doesn't fit there *and* fits whole above — the About menu at the
// foot of the side drawer is the case that still flips. When it fits neither
// way it stays below and scrolls inside its own box.
// `drop="down"` rules the flip out altogether and scrolls inside its own box.
//
// **iOS draws `position: fixed` in a different space than it measures in.** In
// the installed iOS PWA with the keyboard up, the trigger's
// `getBoundingClientRect()` and the coordinates a fixed layer is placed at
// disagree by the keyboard's scroll offset, so a panel placed at "the
// trigger's bottom edge" lands a couple of hundred pixels higher — straight
// over the header and under the status bar, even when asked to drop down. No
// single viewport reading predicts the gap, so the panel measures where it
// actually landed after each placement and shifts by the difference. The
// visible band is taken in the fixed layer's own space (the visual viewport,
// exactly as the app shell is pinned — see `useViewportHeight`) and carried
// across by the same difference.

type Props = {
  open: boolean;
  onClose: () => void;
  placement: FloatingPlacement;
  className?: string;
  children: ReactNode;
  /**
   * `"auto"` (the default) opens below the trigger, and only flips above when
   * the content doesn't fit below but fits whole above. `"down"` never
   * flips: it clamps the height to what is left below and scrolls.
   */
  drop?: "auto" | "down";
} & (
  | { triggerRef: RefObject<HTMLElement>; anchorPoint?: undefined }
  | { anchorPoint: FloatingPoint; triggerRef?: RefObject<HTMLElement> }
);

// Where a panel sits, in the fixed (or absolute) layer's own coordinates.
type Position = {
  top: number;
  left: number;
  width: number;
  maxWidth: number;
  maxHeight: number;
  // The top edge in client coordinates — what `getBoundingClientRect()`
  // should report for the panel once it is placed at `top`.
  clientTop: number;
};

// The fewest pixels a clamped panel keeps, so a couple of rows stay reachable
// in the extreme case instead of collapsing to nothing.
const MIN_HEIGHT = 80;

export function FloatingPanel({
  open,
  onClose,
  triggerRef,
  anchorPoint,
  placement,
  className = "",
  children,
  drop = "auto",
}: Props) {
  const [position, setPosition] = useState<Position | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // client − layer: how far `getBoundingClientRect()` reads from the
  // coordinates the panel is placed at. Zero everywhere but iOS with the
  // keyboard up; learnt from the panel itself after each placement.
  const skewRef = useRef(0);
  // The content's full height, read off the rendered panel.
  const naturalRef = useRef(0);
  // Read through refs so the measuring listeners below never re-bind.
  const placementRef = useRef(placement);
  placementRef.current = placement;
  const dropRef = useRef(drop);
  dropRef.current = drop;
  const triggerElRef = useRef(triggerRef);
  triggerElRef.current = triggerRef;
  const pointRef = useRef(anchorPoint);
  pointRef.current = anchorPoint;
  const placeRef = useRef<() => void>(() => {});
  // Re-placements since the last outside cause (open, resize, scroll). A real
  // engine settles in one or two; the cap is for one that never reports where
  // the panel landed (jsdom reads every box as zero), which would otherwise
  // chase its own correction forever.
  const correctionsRef = useRef(0);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      skewRef.current = 0;
      naturalRef.current = 0;
      return;
    }
    function place() {
      const point = pointRef.current;
      const el = triggerElRef.current?.current;
      const box = point
        ? new DOMRect(point.x, point.y, 0, 0)
        : el?.getBoundingClientRect();
      if (!box) return;
      const p = placementRef.current;
      const gap = p.gap ?? 4;
      const margin = p.viewportMargin ?? 8;
      const documentSpace = p.coordinateSpace === "document";
      const scrollY = documentSpace ? window.scrollY : 0;
      const skew = skewRef.current;

      // The visible band in the layer's coordinates, carried into client
      // coordinates by the measured skew.
      const band = visibleBand(p);
      const bandTop = band.offsetTop + skew;
      const bandBottom = bandTop + band.height;

      const spaceBelow = bandBottom - box.bottom - gap - margin;
      const spaceAbove = box.top - bandTop - gap - margin;
      const natural = naturalRef.current;
      const above =
        dropRef.current === "auto" &&
        natural > spaceBelow &&
        natural <= spaceAbove;

      let clientTop: number;
      let maxHeight: number;
      if (above) {
        maxHeight = Math.max(MIN_HEIGHT, spaceAbove);
        const height = Math.min(natural, maxHeight);
        clientTop = Math.max(bandTop + margin, box.top - gap - height);
      } else {
        clientTop = box.bottom + gap;
        maxHeight = Math.max(MIN_HEIGHT, spaceBelow);
      }

      // Width and horizontal clamping are the framework's, unchanged.
      const base = computeFloatingRect(
        box,
        p,
        { offsetTop: 0, height: 1e6 },
        {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        },
      );
      setPosition({
        top: clientTop - skew + scrollY,
        left: base.left,
        width: base.width,
        maxWidth: base.maxWidth,
        maxHeight,
        clientTop,
      });
    }
    function measure() {
      correctionsRef.current = 0;
      place();
    }
    function remeasure() {
      forgetSafeArea();
      measure();
    }
    placeRef.current = place;
    measure();
    window.addEventListener("resize", remeasure);
    window.addEventListener("scroll", measure, true);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", remeasure);
    vv?.addEventListener("scroll", measure);
    return () => {
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("scroll", measure, true);
      vv?.removeEventListener("resize", remeasure);
      vv?.removeEventListener("scroll", measure);
    };
  }, [open, anchorPoint?.x, anchorPoint?.y]);

  // Check the placement against where the panel actually landed, and against
  // how tall its content really is, and re-place if either was off. Both
  // settle after a pass (the skew is a constant offset, the height is the
  // content's).
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!position || !el || correctionsRef.current >= 2) return;
    const skew =
      skewRef.current + el.getBoundingClientRect().top - position.clientTop;
    const natural = el.scrollHeight + (el.offsetHeight - el.clientHeight);
    const skewed = Math.abs(skew - skewRef.current) > 0.5;
    const grew = Math.abs(natural - naturalRef.current) > 0.5;
    if (!skewed && !grew) return;
    skewRef.current = skew;
    naturalRef.current = natural;
    correctionsRef.current += 1;
    placeRef.current();
  }, [position]);

  useEscapeKey(open, onClose);

  // Hand focus back to the trigger when the panel closes having taken it —
  // otherwise a keyboard user is dropped at the top of the document.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const trigger = triggerRef?.current;
    if (trigger && document.activeElement === document.body) {
      trigger.focus({ preventScroll: true });
    }
  }, [open, triggerRef]);

  if (!open || !position) return null;
  const fixedWidth = placement.width.kind === "max";
  return createPortal(
    <>
      <DismissBackdrop onDismiss={onClose} />
      <div
        ref={panelRef}
        className={`${placement.coordinateSpace === "viewport" ? "fixed" : "absolute"} z-[60] flex flex-col overflow-y-auto rounded-md border border-line bg-surface-2 shadow-lg focus-within:border-accent ${className}`.trim()}
        style={{
          top: position.top,
          left: position.left,
          minWidth: position.width,
          maxWidth: fixedWidth ? position.width : position.maxWidth,
          maxHeight: position.maxHeight,
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

// The on-screen band a panel may occupy, in the fixed layer's coordinates:
// the visual viewport, less the safe-area insets and any chrome marked as an
// edge — the same band the framework's own panels respect.
function visibleBand(placement: FloatingPlacement): {
  offsetTop: number;
  height: number;
} {
  const vv = window.visualViewport;
  const viewport = vv
    ? { offsetTop: vv.offsetTop, height: vv.height }
    : { offsetTop: 0, height: window.innerHeight };
  const edges = placement.edges ?? "safe";
  if (edges === "none") return viewport;
  const layoutHeight = window.innerHeight;
  const insets = edges === "safe" ? readEdgeInsets(layoutHeight) : edges;
  return insetViewport(viewport, insets, layoutHeight);
}
