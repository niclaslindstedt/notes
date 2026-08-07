// @vitest-environment jsdom
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { FloatingPanel } from "../../src/ui/FloatingPanel.tsx";
import type { FloatingPlacement } from "../../src/ui/hooks/useFloatingPosition.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PLACEMENT: FloatingPlacement = {
  width: { kind: "min", minPx: 200 },
  anchor: "left",
  coordinateSpace: "viewport",
};

// The styling toolbar's block-style trigger on a phone: pinned just under the
// editor header, so ~118–150px down a 393px-wide screen.
const TRIGGER = { top: 118, bottom: 150, left: 183, width: 34, height: 32 };

// Stand the window up at `height` CSS pixels — what the soft keyboard leaves of
// an 852px screen once it is up. jsdom has no visualViewport, and the framework
// falls back to `window.innerHeight`, which is what makes this faithful.
function viewport(height: number) {
  vi.stubGlobal("innerWidth", 393);
  vi.stubGlobal("innerHeight", height);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    ...TRIGGER,
    right: TRIGGER.left + TRIGGER.width,
    x: TRIGGER.left,
    y: TRIGGER.top,
    toJSON: () => ({}),
  } as DOMRect);
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

describe("FloatingPanel drop", () => {
  it("pins the panel below the trigger when the viewport is short", () => {
    // 250px is roughly what an iPhone leaves with the keyboard up. The default
    // flips above here, which for a trigger 118px from the top means drawing
    // the panel off the top edge — where, being `position: fixed`, it cannot be
    // scrolled back into view.
    viewport(250);
    render(<Harness drop="down" />);
    const style = panel().style;
    // Below the trigger's bottom edge, not above its top.
    expect(Number.parseFloat(style.top)).toBeGreaterThan(TRIGGER.bottom);
    expect(style.transform).toBe("");
    // And clamped to what is left of the viewport, so it scrolls in place
    // rather than running off the bottom.
    expect(Number.parseFloat(style.maxHeight)).toBeLessThanOrEqual(
      250 - TRIGGER.bottom,
    );
    expect(panel().className).toContain("overflow-y-auto");
  });

  it("still drops below on a tall viewport, matching the default", () => {
    viewport(852);
    render(<Harness drop="down" />);
    expect(Number.parseFloat(panel().style.top)).toBeGreaterThan(
      TRIGGER.bottom,
    );
  });

  it("leaves the framework's own flip in place for drop=auto", () => {
    // The default is untouched: on the same short viewport it flips above,
    // which is the behaviour every other call site still gets.
    viewport(250);
    render(<Harness />);
    expect(panel().style.transform).toBe("translateY(-100%)");
  });
});
