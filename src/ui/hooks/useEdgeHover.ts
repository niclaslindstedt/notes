// Reveals a control that is otherwise invisible, by watching whether the
// cursor is resting over the band of screen the control occupies.
//
// The sidebar's collapse rail is the reason this exists: it has to give its
// pixels back to the app when it isn't wanted, which means it can't be drawn
// *or* absorb clicks until the pointer actually goes looking for it. Plain
// `:hover` can't express that — an element with `pointer-events: none` never
// hovers, and one with pointer events on steals every press aimed at whatever
// it covers. So the pointer is tracked at the window instead, and the caller
// flips both the paint and the pointer events on the answer.

import { useEffect, useState, type RefObject } from "react";

/**
 * True while a fine pointer sits inside `ref`'s box.
 *
 * @param ref     The element whose band is being watched. It must be laid out
 *                (an `opacity-0` overlay is fine; a `display: none` one is not,
 *                since a zero-sized box can never be entered).
 * @param enabled Off means "never hovering" — pass the hover-capability media
 *                query so a touch device, which can't hover at all, keeps the
 *                control permanently visible instead of permanently hidden.
 * @param slop    Pixels of grace added around the box *once entered*, so a
 *                cursor parked on the boundary can't flicker the control in
 *                and out on every sub-pixel jitter.
 */
export function useEdgeHover(
  ref: RefObject<HTMLElement>,
  enabled: boolean,
  slop = 8,
): boolean {
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setHovering(false);
      return;
    }

    let frame = 0;
    let latest: { x: number; y: number } | null = null;

    const measure = () => {
      frame = 0;
      const el = ref.current;
      const point = latest;
      if (!el || !point) return;
      const box = el.getBoundingClientRect();
      setHovering((prev) => {
        const pad = prev ? slop : 0;
        return (
          point.x >= box.left - pad &&
          point.x <= box.right + pad &&
          point.y >= box.top - pad &&
          point.y <= box.bottom + pad
        );
      });
    };

    const onMove = (e: PointerEvent) => {
      // A tap is not a hover: honouring one would flash the control open under
      // the finger and leave it stuck there with nothing to move away.
      if (e.pointerType === "touch") return;
      latest = { x: e.clientX, y: e.clientY };
      // Coalesce to one measurement per frame — the listener is on the window,
      // so it sees every move across the whole app.
      if (!frame) frame = requestAnimationFrame(measure);
    };

    const forget = () => {
      latest = null;
      setHovering(false);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    // The cursor can leave the document (or the window lose focus) without a
    // final move inside it, which would otherwise strand the control on screen.
    document.addEventListener("pointerleave", forget);
    window.addEventListener("blur", forget);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", forget);
      window.removeEventListener("blur", forget);
    };
  }, [ref, enabled, slop]);

  return hovering;
}
