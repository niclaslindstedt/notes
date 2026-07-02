// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scrollFocusedIntoView } from "../../src/ui/hooks/scrollFocusedIntoView.ts";

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

beforeEach(() => {
  vi.useFakeTimers();
  vv = fakeVisualViewport();
  Object.defineProperty(window, "visualViewport", {
    value: vv,
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("scrollFocusedIntoView", () => {
  it("re-centres on every viewport change until the burst goes quiet", () => {
    const el = document.createElement("div");
    document.body.append(el);
    const scrollIntoView = vi.fn();
    el.scrollIntoView = scrollIntoView;

    scrollFocusedIntoView(el);

    // The keyboard animates in as a burst of resize events; each one must
    // re-centre so the final (settled) height wins, not the first intermediate
    // one that leaves the last line behind the keyboard.
    vv.emit("resize");
    vv.emit("resize");
    vv.emit("resize");
    expect(scrollIntoView).toHaveBeenCalledTimes(3);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "center" });

    // Once the viewport has been quiet past the settle window, it stops
    // listening so a later user scroll never yanks the view.
    vi.advanceTimersByTime(250);
    expect(vv.count("resize")).toBe(0);
    expect(vv.count("scroll")).toBe(0);
    vv.emit("resize");
    expect(scrollIntoView).toHaveBeenCalledTimes(3);
  });

  it("reveals once via the backstop when the keyboard never moves the viewport", () => {
    const el = document.createElement("div");
    document.body.append(el);
    const scrollIntoView = vi.fn();
    el.scrollIntoView = scrollIntoView;

    scrollFocusedIntoView(el);
    expect(scrollIntoView).not.toHaveBeenCalled();

    vi.advanceTimersByTime(350);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(vv.count("resize")).toBe(0);
  });

  it("does not fire the backstop reveal after the viewport burst handled it", () => {
    const el = document.createElement("div");
    document.body.append(el);
    const scrollIntoView = vi.fn();
    el.scrollIntoView = scrollIntoView;

    scrollFocusedIntoView(el);
    vv.emit("resize");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // The 350ms backstop must not add a stray reveal once real events arrived.
    vi.advanceTimersByTime(350);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("centres synchronously when there is no visual viewport", () => {
    Object.defineProperty(window, "visualViewport", {
      value: undefined,
      configurable: true,
    });
    const el = document.createElement("div");
    document.body.append(el);
    const scrollIntoView = vi.fn();
    el.scrollIntoView = scrollIntoView;

    scrollFocusedIntoView(el);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });
});
