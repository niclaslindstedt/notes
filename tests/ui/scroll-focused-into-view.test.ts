// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bufferedScrollTop,
  centeredScrollTop,
  scrollFocusedIntoView,
} from "../../src/ui/hooks/scrollFocusedIntoView.ts";

// A minimal `visualViewport` stub that records listeners and lets a test drive
// the keyboard-settling burst by dispatching `resize` events by hand.
function fakeVisualViewport() {
  const listeners: Record<string, Set<() => void>> = {
    resize: new Set(),
    scroll: new Set(),
  };
  return {
    addEventListener: (type: string, fn: () => void) => {
      listeners[type]?.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => {
      listeners[type]?.delete(fn);
    },
    emit: (type: "resize" | "scroll") => {
      for (const fn of [...listeners[type]!]) fn();
    },
    count: (type: "resize" | "scroll") => listeners[type]!.size,
  };
}

let vv: ReturnType<typeof fakeVisualViewport>;

// Pin the reduced-motion query so the smooth/instant branch is deterministic.
function stubReducedMotion(reduce: boolean) {
  Object.defineProperty(window, "matchMedia", {
    value: (query: string) => ({ matches: reduce, media: query }),
    configurable: true,
  });
}

// A tapped line inside a scrollable container. jsdom does no layout, so the
// geometry (rects, scroll metrics) is stubbed by hand; the helper reads it the
// same as it would a real element and scrolls the *container* (never the
// window) via `scrollTo`, which we spy on.
function scrollableLine() {
  const scroller = document.createElement("div");
  const line = document.createElement("div");
  scroller.append(line);
  document.body.append(scroller);

  scroller.style.overflowY = "auto";
  Object.defineProperty(scroller, "scrollHeight", {
    value: 2000,
    configurable: true,
  });
  Object.defineProperty(scroller, "clientHeight", {
    value: 400,
    configurable: true,
  });
  scroller.scrollTop = 0;
  scroller.getBoundingClientRect = () => ({ top: 0, height: 400 }) as DOMRect;
  // The line sits at content offset 300; on screen it rides up as the container
  // scrolls, so re-centring converges rather than compounding (as it would in a
  // real browser).
  line.getBoundingClientRect = () =>
    ({ top: 300 - scroller.scrollTop, height: 20 }) as DOMRect;

  const scrollTo = vi.fn((opts: ScrollToOptions) => {
    if (typeof opts?.top === "number") scroller.scrollTop = opts.top;
  });
  scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
  return { scroller, line, scrollTo };
}

beforeEach(() => {
  vi.useFakeTimers();
  stubReducedMotion(false);
  vv = fakeVisualViewport();
  Object.defineProperty(window, "visualViewport", {
    value: vv,
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("centeredScrollTop", () => {
  it("centres the element within the scroll container's band", () => {
    // Element at content offset 300, band 400 tall, element 20 tall → its top
    // should sit at (400 - 20) / 2 = 190 below the band top, i.e. scrollTop 110.
    expect(centeredScrollTop(300, 20, 0, 0, 400, 2000)).toBe(110);
  });

  it("clamps to the top so a first line is never pushed above the band", () => {
    // A line already at the band top can't be centred without scrolling past 0;
    // clamp keeps it visible at the top instead of flinging it off screen.
    expect(centeredScrollTop(0, 20, 0, 0, 400, 2000)).toBe(0);
  });

  it("clamps to the bottom so a last line rests at the band's foot", () => {
    const max = 2000 - 400;
    expect(centeredScrollTop(1990, 20, 0, 1600, 400, 2000)).toBe(max);
  });
});

describe("bufferedScrollTop", () => {
  // Band 400 tall, line 20 tall, one-line buffer (20).
  it("leaves the view alone when the line sits inside the buffered band", () => {
    // Line at content offset 100, band showing content 0..400 → well clear of
    // both edges, so scrollTop is returned unchanged.
    expect(bufferedScrollTop(100, 20, 0, 0, 400, 2000, 20)).toBe(0);
  });

  it("pulls the content up so the line clears the bottom edge by one line", () => {
    // Line pressed to the very foot of the band (top 380, bottom 400). Its
    // bottom (400) plus the 20 buffer must sit at the band foot, so scrollTop
    // advances by 20: bottom 400 + buffer 20 - clientHeight 400 = 20.
    expect(bufferedScrollTop(380, 20, 0, 0, 400, 2000, 20)).toBe(20);
  });

  it("keeps a whole extra line of breathing room below the caret", () => {
    // Line just off the bottom edge (top 395): after scrolling, the gap beneath
    // it is a full line height, never a sliver.
    const top = bufferedScrollTop(395, 20, 0, 0, 400, 2000, 20);
    expect(top).toBe(35); // 395 + 20 + 20 - 400
  });

  it("pushes the content down so a hoisted caret clears the top edge", () => {
    // A merge lands the line at the band top (top 0) while scrolled to 500 →
    // push down so the buffer sits above it: topInContent 500 - buffer 20 = 480.
    expect(bufferedScrollTop(0, 20, 0, 500, 400, 2000, 20)).toBe(480);
  });

  it("clamps to the bottom of the scroll range at the last line", () => {
    const max = 2000 - 400;
    // The final line can't gain a buffer without scrolling past the content end;
    // the clamp rests it at the foot instead.
    expect(bufferedScrollTop(390, 20, 0, 1590, 400, 2000, 20)).toBe(max);
  });

  it("clamps to zero at the top of the scroll range", () => {
    expect(bufferedScrollTop(5, 20, 0, 0, 400, 2000, 20)).toBe(0);
  });
});

describe("scrollFocusedIntoView", () => {
  it("re-centres the container on every viewport change until the burst goes quiet", () => {
    const { line, scrollTo } = scrollableLine();

    scrollFocusedIntoView(line);

    // The keyboard animates in as a burst of resize events; each one must
    // re-centre so the final (settled) height wins, not the first intermediate
    // one that leaves the last line behind the keyboard.
    vv.emit("resize");
    vv.emit("resize");
    vv.emit("resize");
    expect(scrollTo).toHaveBeenCalledTimes(3);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 110, behavior: "smooth" });

    // Once the viewport has been quiet past the settle window, it stops
    // listening so a later user scroll never yanks the view.
    vi.advanceTimersByTime(250);
    expect(vv.count("resize")).toBe(0);
    expect(vv.count("scroll")).toBe(0);
    vv.emit("resize");
    expect(scrollTo).toHaveBeenCalledTimes(3);
  });

  it("reveals once via the backstop when the keyboard never moves the viewport", () => {
    const { line, scrollTo } = scrollableLine();

    scrollFocusedIntoView(line);
    expect(scrollTo).not.toHaveBeenCalled();

    vi.advanceTimersByTime(350);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(vv.count("resize")).toBe(0);
  });

  it("does not fire the backstop reveal after the viewport burst handled it", () => {
    const { line, scrollTo } = scrollableLine();

    scrollFocusedIntoView(line);
    vv.emit("resize");
    expect(scrollTo).toHaveBeenCalledTimes(1);

    // The 350ms backstop must not add a stray reveal once real events arrived.
    vi.advanceTimersByTime(350);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("scrolls the container, never the window, so nothing bubbles off screen", () => {
    const { line, scroller } = scrollableLine();
    // `scrollIntoView` on the element would bubble to the window / visual
    // viewport on iOS; the container path must not call it.
    const bubble = vi.fn();
    line.scrollIntoView = bubble;

    scrollFocusedIntoView(line);
    vv.emit("resize");
    expect(bubble).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(110);
  });

  it("falls back to the browser reveal when nothing is scrollable", () => {
    const line = document.createElement("div");
    document.body.append(line);
    const scrollIntoView = vi.fn();
    line.scrollIntoView = scrollIntoView;

    scrollFocusedIntoView(line);
    vv.emit("resize");
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      behavior: "smooth",
    });
  });

  it("centres synchronously when there is no visual viewport", () => {
    Object.defineProperty(window, "visualViewport", {
      value: undefined,
      configurable: true,
    });
    const { line, scrollTo } = scrollableLine();

    scrollFocusedIntoView(line);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 110, behavior: "smooth" });
  });

  it("snaps instantly when the user prefers reduced motion", () => {
    stubReducedMotion(true);
    const { line, scrollTo } = scrollableLine();

    scrollFocusedIntoView(line);
    vv.emit("resize");
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 110, behavior: "auto" });
  });
});
