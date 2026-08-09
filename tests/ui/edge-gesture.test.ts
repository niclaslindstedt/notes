// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MouseEvent, PointerEvent } from "react";

import {
  startsAtScreenEdge,
  useEdgeGestureGuard,
  type SwipeGestureHandlers,
} from "../../src/ui/hooks/edge-gesture.ts";
import { useSwipeReveal } from "../../src/ui/hooks/useSwipeReveal.ts";

const WIDTH = 400;

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", {
    value: WIDTH,
    configurable: true,
  });
});

// The handlers only read these fields off the synthetic event, and jsdom has
// no PointerEvent constructor — fabricate the minimal shape.
function pointer(
  x: number,
  y = 100,
  pointerType = "touch",
): PointerEvent<HTMLElement> {
  return {
    pointerId: 1,
    pointerType,
    clientX: x,
    clientY: y,
    currentTarget: {
      offsetWidth: WIDTH,
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => false,
      releasePointerCapture: vi.fn(),
    },
    preventDefault: vi.fn(),
  } as unknown as PointerEvent<HTMLElement>;
}

function click(): MouseEvent<Element> & {
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: ReturnType<typeof vi.fn>;
} {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as MouseEvent<Element> & {
    preventDefault: ReturnType<typeof vi.fn>;
    stopPropagation: ReturnType<typeof vi.fn>;
  };
}

function spies(): SwipeGestureHandlers {
  return {
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onPointerCancel: vi.fn(),
    onClickCapture: vi.fn(),
  };
}

describe("startsAtScreenEdge", () => {
  it("claims both borders and nothing between them", () => {
    expect(startsAtScreenEdge(0)).toBe(true);
    expect(startsAtScreenEdge(30)).toBe(true);
    expect(startsAtScreenEdge(31)).toBe(false);
    expect(startsAtScreenEdge(WIDTH / 2)).toBe(false);
    expect(startsAtScreenEdge(WIDTH - 30)).toBe(true);
    expect(startsAtScreenEdge(WIDTH)).toBe(true);
  });
});

describe("useEdgeGestureGuard", () => {
  it("keeps an inward swipe from the left edge away from the row", () => {
    const inner = spies();
    const { result } = renderHook(() => useEdgeGestureGuard(inner));

    result.current.onPointerDown(pointer(5));
    result.current.onPointerMove(pointer(60));
    result.current.onPointerUp(pointer(60));

    expect(inner.onPointerDown).not.toHaveBeenCalled();
    expect(inner.onPointerMove).not.toHaveBeenCalled();
    expect(inner.onPointerUp).not.toHaveBeenCalled();

    // …and the click the browser synthesizes at the end never reaches the row,
    // so the note it started over is not opened.
    const tap = click();
    result.current.onClickCapture(tap);
    expect(tap.preventDefault).toHaveBeenCalled();
    expect(tap.stopPropagation).toHaveBeenCalled();
    expect(inner.onClickCapture).not.toHaveBeenCalled();
  });

  it("keeps an inward swipe from the right edge away from the row", () => {
    const inner = spies();
    const { result } = renderHook(() => useEdgeGestureGuard(inner));

    result.current.onPointerDown(pointer(WIDTH - 5));
    result.current.onPointerMove(pointer(WIDTH - 70));
    result.current.onPointerUp(pointer(WIDTH - 70));

    expect(inner.onPointerDown).not.toHaveBeenCalled();
    const tap = click();
    result.current.onClickCapture(tap);
    expect(tap.preventDefault).toHaveBeenCalled();
  });

  it("swallows an edge swipe that arcs downward (the row reads it as a scroll)", () => {
    const inner = spies();
    const { result } = renderHook(() => useEdgeGestureGuard(inner));

    result.current.onPointerDown(pointer(6, 100));
    result.current.onPointerMove(pointer(20, 130));
    result.current.onPointerUp(pointer(20, 130));

    const tap = click();
    result.current.onClickCapture(tap);
    expect(tap.preventDefault).toHaveBeenCalled();
  });

  it("lets a stationary tap at the edge through", () => {
    const inner = spies();
    const { result } = renderHook(() => useEdgeGestureGuard(inner));

    result.current.onPointerDown(pointer(8));
    result.current.onPointerMove(pointer(10, 102));
    result.current.onPointerUp(pointer(10, 102));

    const tap = click();
    result.current.onClickCapture(tap);
    expect(tap.preventDefault).not.toHaveBeenCalled();
    expect(inner.onClickCapture).toHaveBeenCalledWith(tap);
  });

  it("passes a gesture that starts away from the edges straight through", () => {
    const inner = spies();
    const { result } = renderHook(() => useEdgeGestureGuard(inner));

    const down = pointer(200);
    result.current.onPointerDown(down);
    result.current.onPointerMove(pointer(260));
    result.current.onPointerUp(pointer(260));

    expect(inner.onPointerDown).toHaveBeenCalledWith(down);
    expect(inner.onPointerMove).toHaveBeenCalled();
    expect(inner.onPointerUp).toHaveBeenCalled();
  });

  it("never stands down for a mouse (a narrow window keeps every row clickable)", () => {
    const inner = spies();
    const { result } = renderHook(() => useEdgeGestureGuard(inner));

    result.current.onPointerDown(pointer(4, 100, "mouse"));
    result.current.onPointerMove(pointer(40, 100, "mouse"));
    result.current.onPointerUp(pointer(40, 100, "mouse"));

    expect(inner.onPointerDown).toHaveBeenCalled();
    const tap = click();
    result.current.onClickCapture(tap);
    expect(tap.preventDefault).not.toHaveBeenCalled();
  });

  it("does not eat the next tap when the edge swipe ended without a click", () => {
    const inner = spies();
    const { result } = renderHook(() => useEdgeGestureGuard(inner));

    // The drawer took this one, so no click is ever dispatched to the row.
    result.current.onPointerDown(pointer(5));
    result.current.onPointerMove(pointer(80));
    result.current.onPointerUp(pointer(80));

    // A later, ordinary tap on the same row must still open it.
    result.current.onPointerDown(pointer(200));
    result.current.onPointerUp(pointer(200));
    const tap = click();
    result.current.onClickCapture(tap);
    expect(tap.preventDefault).not.toHaveBeenCalled();
    expect(inner.onClickCapture).toHaveBeenCalledWith(tap);
  });

  it("re-arms the row for the next gesture away from the edge", () => {
    const inner = spies();
    const { result } = renderHook(() => useEdgeGestureGuard(inner));

    result.current.onPointerDown(pointer(5));
    result.current.onPointerMove(pointer(60));
    result.current.onPointerCancel(pointer(60));
    result.current.onClickCapture(click());

    const down = pointer(200);
    result.current.onPointerDown(down);
    expect(inner.onPointerDown).toHaveBeenCalledWith(down);
  });
});

describe("useSwipeReveal edge guard", () => {
  it("does not slide or archive a row on a swipe that starts at the edge", () => {
    const onArchive = vi.fn();
    const { result } = renderHook(() => useSwipeReveal(96, onArchive));

    act(() => {
      result.current.handlers.onPointerDown(pointer(5));
      result.current.handlers.onPointerMove(pointer(150));
      result.current.handlers.onPointerUp(pointer(150));
    });

    expect(result.current.offset).toBe(0);
    expect(onArchive).not.toHaveBeenCalled();
  });

  it("still slides a row swiped from the middle", () => {
    const onArchive = vi.fn();
    const { result } = renderHook(() => useSwipeReveal(96, onArchive));

    act(() => {
      result.current.handlers.onPointerDown(pointer(200));
      result.current.handlers.onPointerMove(pointer(250));
    });

    expect(result.current.offset).toBe(50);
  });
});
