// @vitest-environment jsdom
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/preact";

import { FloatingPanel } from "../../src/ui/FloatingPanel.tsx";
import type { FloatingPlacement } from "../../src/ui/hooks/useFloatingPosition.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const PLACEMENT: FloatingPlacement = {
  width: { kind: "min", minPx: 200 },
  anchor: "left",
  coordinateSpace: "viewport",
  edges: "none",
};

type Box = { top: number; bottom: number; left: number; width: number };

// The styling toolbar's block-style trigger on a phone: pinned just under the
// editor header, so ~118–150px down a 393px-wide screen.
const TOOLBAR: Box = { top: 118, bottom: 150, left: 183, width: 34 };

function rect({ top, bottom, left, width }: Box): DOMRect {
  return {
    top,
    bottom,
    left,
    width,
    height: bottom - top,
    right: left + width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

// Stand a phone up: `height` CSS pixels of visible viewport (what the soft
// keyboard leaves of an 852px screen), scrolled `offsetTop` into the layout
// viewport, with a panel whose rows add up to `content` pixels. `skew` is how
// far the browser *measures* a fixed layer from where it placed it — zero on
// a well-behaved engine, the keyboard's scroll offset in the iOS PWA.
function phone({
  height,
  offsetTop = 0,
  skew = 0,
  content = 190,
  trigger = TOOLBAR,
}: {
  height: number;
  offsetTop?: number;
  skew?: number;
  content?: number;
  trigger?: Box;
}) {
  vi.stubGlobal("innerWidth", 393);
  vi.stubGlobal("innerHeight", 852);
  vi.stubGlobal("visualViewport", {
    offsetTop,
    height,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.tagName === "BUTTON") return rect(trigger);
      const top = Number.parseFloat(this.style.top) + skew;
      const shown = Math.min(content, Number.parseFloat(this.style.maxHeight));
      return rect({ top, bottom: top + shown, left: 0, width: 200 });
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(
    content,
  );
}

function Harness({ drop }: { drop?: "auto" | "down" }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={triggerRef}>
        trigger
      </button>
      <FloatingPanel
        open
        onClose={() => {}}
        triggerRef={triggerRef}
        placement={PLACEMENT}
        drop={drop}
      >
        <div data-testid="panel-content">rows</div>
      </FloatingPanel>
    </>
  );
}

function panel(): HTMLElement {
  return screen.getByTestId("panel-content").parentElement!;
}

// Where the panel appears on screen, in the same coordinates as the trigger.
function onScreen() {
  const box = panel().getBoundingClientRect();
  return {
    top: box.top,
    maxHeight: Number.parseFloat(panel().style.maxHeight),
  };
}

describe("FloatingPanel", () => {
  it("drops below the toolbar with the keyboard up, however short the viewport", () => {
    // 250px is roughly what an iPhone leaves with the keyboard up. The room
    // below is short of the panel's rows; opening above instead would draw
    // them off the top of the screen, over the header.
    phone({ height: 250 });
    render(<Harness drop="down" />);
    expect(onScreen().top).toBe(TOOLBAR.bottom + 4);
    // Clamped to what is left, so it scrolls in place rather than running off
    // the bottom.
    expect(onScreen().maxHeight).toBeLessThanOrEqual(250 - TOOLBAR.bottom);
    expect(panel().className).toContain("overflow-y-auto");
  });

  it("drops below by default when the rows fit, even on a short viewport", () => {
    // The framework flips at a fixed ~180px threshold; a short menu that fits
    // below its trigger has no reason to cover it.
    phone({ height: 400, content: 150 });
    render(<Harness />);
    expect(onScreen().top).toBe(TOOLBAR.bottom + 4);
  });

  it("stays below by default when the rows fit neither way", () => {
    // 106px above, 88px below, 190px of rows: better to scroll below the
    // trigger than to cover it and still not fit.
    phone({ height: 250 });
    render(<Harness />);
    expect(onScreen().top).toBe(TOOLBAR.bottom + 4);
  });

  it("flips above only when the rows don't fit below and fit whole above", () => {
    // The About menu at the foot of the side drawer.
    const footer = { top: 790, bottom: 822, left: 20, width: 40 };
    phone({ height: 852, content: 150, trigger: footer });
    render(<Harness />);
    const { top } = onScreen();
    expect(top + 150).toBe(footer.top - 4);
    expect(top).toBeGreaterThanOrEqual(8);
  });

  it("never flips with drop=down", () => {
    const footer = { top: 790, bottom: 822, left: 20, width: 40 };
    phone({ height: 852, content: 150, trigger: footer });
    render(<Harness drop="down" />);
    expect(onScreen().top).toBe(footer.bottom + 4);
  });

  it("lands under its trigger when iOS measures fixed layers off by the keyboard scroll", () => {
    // The installed iOS PWA with the keyboard up: the visual viewport has
    // scrolled 198px into the layout viewport, and a fixed layer placed at y
    // reads back at y − 198. Placed naively at the trigger's bottom edge, the
    // panel would appear 198px higher — over the header, under the status bar.
    phone({ height: 250, offsetTop: 198, skew: -198 });
    render(<Harness drop="down" />);
    const { top, maxHeight } = onScreen();
    expect(top).toBe(TOOLBAR.bottom + 4);
    // And the height still clamps to the visible band, not the skewed one.
    expect(maxHeight).toBe(250 - (TOOLBAR.bottom + 4) - 8);
  });
});
