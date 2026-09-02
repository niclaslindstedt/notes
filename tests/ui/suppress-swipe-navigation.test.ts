// @vitest-environment jsdom
import { renderHook } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";

import { useSuppressSwipeNavigation } from "../../src/ui/hooks/useSuppressSwipeNavigation.ts";

// jsdom has no real TouchEvent constructor; fabricate the minimal shape the
// hook reads (touches[].clientX/Y, cancelable, preventDefault).
function touchEvent(
  type: string,
  points: Array<{ x: number; y: number }>,
): TouchEvent {
  const e = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  Object.defineProperty(e, "touches", {
    value: points.map((p) => ({ clientX: p.x, clientY: p.y })),
  });
  return e;
}

describe("useSuppressSwipeNavigation", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function dispatch(
    type: string,
    points: Array<{ x: number; y: number }>,
    on: EventTarget = document,
  ) {
    const e = touchEvent(type, points);
    on.dispatchEvent(e);
    return e;
  }

  /** An element that really does scroll sideways, which jsdom won't do itself. */
  function horizontalScroller(): HTMLElement {
    const el = document.createElement("div");
    el.style.overflowX = "auto";
    Object.defineProperty(el, "scrollWidth", { value: 800 });
    Object.defineProperty(el, "clientWidth", { value: 300 });
    document.body.append(el);
    return el;
  }

  it("cancels a horizontal swipe from the left (the back gesture)", () => {
    renderHook(() => useSuppressSwipeNavigation());
    dispatch("touchstart", [{ x: 5, y: 200 }]);
    const move = dispatch("touchmove", [{ x: 60, y: 205 }]);
    expect(move.defaultPrevented).toBe(true);
  });

  it("cancels a horizontal swipe from the right (the forward gesture)", () => {
    renderHook(() => useSuppressSwipeNavigation());
    dispatch("touchstart", [{ x: 1020, y: 200 }]);
    const move = dispatch("touchmove", [{ x: 960, y: 198 }]);
    expect(move.defaultPrevented).toBe(true);
  });

  it("cancels a horizontal swipe that starts away from the edges", () => {
    renderHook(() => useSuppressSwipeNavigation());
    dispatch("touchstart", [{ x: 400, y: 200 }]);
    const move = dispatch("touchmove", [{ x: 460, y: 205 }]);
    expect(move.defaultPrevented).toBe(true);
  });

  it("keeps cancelling for the rest of a claimed gesture", () => {
    renderHook(() => useSuppressSwipeNavigation());
    dispatch("touchstart", [{ x: 400, y: 200 }]);
    dispatch("touchmove", [{ x: 460, y: 205 }]);
    const later = dispatch("touchmove", [{ x: 520, y: 260 }]);
    expect(later.defaultPrevented).toBe(true);
  });

  it("claims a swipe that arcs downward before it turns horizontal", () => {
    renderHook(() => useSuppressSwipeNavigation());
    dispatch("touchstart", [{ x: 5, y: 200 }]);
    // The first pixels lean vertical but neither axis has won yet, so the
    // gesture stays undecided rather than being written off as a scroll.
    const early = dispatch("touchmove", [{ x: 8, y: 204 }]);
    expect(early.defaultPrevented).toBe(false);
    const move = dispatch("touchmove", [{ x: 70, y: 215 }]);
    expect(move.defaultPrevented).toBe(true);
  });

  it("leaves a vertical scroll alone", () => {
    renderHook(() => useSuppressSwipeNavigation());
    dispatch("touchstart", [{ x: 5, y: 200 }]);
    const move = dispatch("touchmove", [{ x: 8, y: 280 }]);
    expect(move.defaultPrevented).toBe(false);
  });

  it("keeps a scroll a scroll once it has committed to the vertical", () => {
    renderHook(() => useSuppressSwipeNavigation());
    dispatch("touchstart", [{ x: 400, y: 200 }]);
    dispatch("touchmove", [{ x: 402, y: 280 }]);
    const later = dispatch("touchmove", [{ x: 500, y: 285 }]);
    expect(later.defaultPrevented).toBe(false);
  });

  it("leaves a drag inside a horizontal scroller alone", () => {
    renderHook(() => useSuppressSwipeNavigation());
    const scroller = horizontalScroller();
    dispatch("touchstart", [{ x: 400, y: 200 }], scroller);
    const move = dispatch("touchmove", [{ x: 460, y: 205 }], scroller);
    expect(move.defaultPrevented).toBe(false);
  });

  it("claims a drag inside a box that does not actually scroll sideways", () => {
    renderHook(() => useSuppressSwipeNavigation());
    const el = document.createElement("div");
    el.style.overflowX = "auto";
    document.body.append(el);
    dispatch("touchstart", [{ x: 400, y: 200 }], el);
    const move = dispatch("touchmove", [{ x: 460, y: 205 }], el);
    expect(move.defaultPrevented).toBe(true);
  });

  it("ignores multi-touch (pinch/zoom) gestures", () => {
    renderHook(() => useSuppressSwipeNavigation());
    dispatch("touchstart", [
      { x: 5, y: 200 },
      { x: 50, y: 200 },
    ]);
    const move = dispatch("touchmove", [
      { x: 60, y: 200 },
      { x: 120, y: 200 },
    ]);
    expect(move.defaultPrevented).toBe(false);
  });
});
