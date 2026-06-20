// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
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
    Object.defineProperty(window, "innerWidth", {
      value: 1024,
      configurable: true,
    });
  });

  function dispatch(type: string, points: Array<{ x: number; y: number }>) {
    const e = touchEvent(type, points);
    document.dispatchEvent(e);
    return e;
  }

  it("cancels a horizontal swipe starting at the left edge (back gesture)", () => {
    renderHook(() => useSuppressSwipeNavigation());
    dispatch("touchstart", [{ x: 5, y: 200 }]);
    const move = dispatch("touchmove", [{ x: 60, y: 205 }]);
    expect(move.defaultPrevented).toBe(true);
  });

  it("cancels a horizontal swipe starting at the right edge (forward gesture)", () => {
    Object.defineProperty(window, "innerWidth", {
      value: 1024,
      configurable: true,
    });
    renderHook(() => useSuppressSwipeNavigation());
    dispatch("touchstart", [{ x: 1020, y: 200 }]);
    const move = dispatch("touchmove", [{ x: 960, y: 198 }]);
    expect(move.defaultPrevented).toBe(true);
  });

  it("leaves a swipe that starts away from the edges alone", () => {
    renderHook(() => useSuppressSwipeNavigation());
    dispatch("touchstart", [{ x: 400, y: 200 }]);
    const move = dispatch("touchmove", [{ x: 460, y: 205 }]);
    expect(move.defaultPrevented).toBe(false);
  });

  it("leaves a vertical scroll from the edge alone", () => {
    renderHook(() => useSuppressSwipeNavigation());
    dispatch("touchstart", [{ x: 5, y: 200 }]);
    const move = dispatch("touchmove", [{ x: 8, y: 280 }]);
    expect(move.defaultPrevented).toBe(false);
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
