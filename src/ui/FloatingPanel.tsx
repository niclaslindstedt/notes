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
  FloatingPanel as FrameworkFloatingPanel,
  computeFloatingRect,
  type FloatingPlacement,
  type FloatingPoint,
  type FloatingRect,
} from "@niclaslindstedt/oss-framework/components";
import { useEscapeKey } from "./hooks/useEscapeKey.ts";

// Portalled dropdown / popover shell (float position, Escape + outside-click
// dismissal). The implementation lives in @niclaslindstedt/oss-framework and
// this file is where the app's call sites point — but it is a **wrapper**, not
// a bare re-export, because of `drop`.
//
// The framework flips a panel above its trigger when there is less than ~180px
// of viewport below it. That is the right default for a control in the middle
// of a page, and wrong for one pinned near the top of the screen: the flip has
// no viewport clamp on that side (the "below" branch clamps twice, the "above"
// branch's height is `max(120, spaceAbove)`), so a panel taller than the room
// above it is drawn straight off the top edge — and being `position: fixed`, it
// can't be scrolled back into view. On a phone with the soft keyboard up, the
// [styling toolbar](../../docs/overview.md)'s menus hit exactly that: the
// toolbar sits directly under the header, the keyboard shortens the viewport
// past the flip threshold, and the menu's first row disappears behind the
// status bar.
//
// So a caller that is structurally near the top of the screen can ask for
// `drop="down"`, which pins the panel below its trigger and lets it scroll
// inside its own box instead. Everything else keeps `drop="auto"` — the
// framework's own behaviour, byte for byte, since that path delegates straight
// to it.

type Props = {
  open: boolean;
  onClose: () => void;
  placement: FloatingPlacement;
  className?: string;
  children: ReactNode;
  /**
   * `"auto"` (the default) lets the framework flip the panel above its trigger
   * when the space below runs short. `"down"` pins it below and clamps its
   * height to what is left, for a trigger with nothing useful above it.
   */
  drop?: "auto" | "down";
} & (
  | { triggerRef: RefObject<HTMLElement>; anchorPoint?: undefined }
  | { anchorPoint: FloatingPoint; triggerRef?: RefObject<HTMLElement> }
);

export function FloatingPanel({ drop = "auto", ...props }: Props) {
  if (drop === "auto") return <FrameworkFloatingPanel {...props} />;
  return <DropDownPanel {...props} />;
}

// The `drop="down"` path. Only the *vertical* decision is ours: the width and
// the horizontal clamping still come from the framework's `computeFloatingRect`
// (via a viewport it can't flip in — see `measure`), so a panel positioned this
// way lines up with every other one.
function DropDownPanel({
  open,
  onClose,
  triggerRef,
  anchorPoint,
  placement,
  className = "",
  children,
}: Omit<Props, "drop">) {
  const [rect, setRect] = useState<FloatingRect | null>(null);
  // Read through refs so the measuring listeners below never re-bind.
  const placementRef = useRef(placement);
  placementRef.current = placement;
  const triggerElRef = useRef(triggerRef);
  triggerElRef.current = triggerRef;
  const pointRef = useRef(anchorPoint);
  pointRef.current = anchorPoint;

  useLayoutEffect(() => {
    if (!open) {
      setRect(null);
      return;
    }
    function measure() {
      const point = pointRef.current;
      const el = triggerElRef.current?.current;
      const box = point
        ? new DOMRect(point.x, point.y, 0, 0)
        : el?.getBoundingClientRect();
      if (!box) return;
      const p = placementRef.current;
      const vv = window.visualViewport;
      const visibleTop = vv?.offsetTop ?? 0;
      const visibleBottom = visibleTop + (vv?.height ?? window.innerHeight);
      const gap = p.gap ?? 4;
      const margin = p.viewportMargin ?? 8;
      // Hand the framework a viewport tall enough that its own flip test can't
      // fire, so what comes back is the below-the-trigger geometry — then keep
      // its width / left and clamp the height against the *real* viewport.
      const unflippable = { offsetTop: visibleTop, height: 1e6 };
      const base = computeFloatingRect(box, p, unflippable, {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      });
      const top = box.bottom + gap;
      setRect({
        ...base,
        top,
        // A short viewport makes the panel scroll rather than escape the
        // screen. The 80px floor keeps a couple of rows reachable in the
        // extreme case instead of collapsing it to nothing.
        maxHeight: Math.max(80, visibleBottom - top - margin),
        placement: "below",
      });
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
    };
  }, [open, anchorPoint?.x, anchorPoint?.y]);

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

  if (!open || !rect) return null;
  const fixedWidth = placement.width.kind === "max";
  return createPortal(
    <>
      <DismissBackdrop onDismiss={onClose} />
      <div
        className={`${placement.coordinateSpace === "viewport" ? "fixed" : "absolute"} z-[60] flex flex-col overflow-y-auto rounded-md border border-line bg-surface-2 shadow-lg focus-within:border-accent ${className}`.trim()}
        style={{
          top: rect.top,
          left: rect.left,
          minWidth: rect.width,
          maxWidth: fixedWidth ? rect.width : rect.maxWidth,
          maxHeight: rect.maxHeight,
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
