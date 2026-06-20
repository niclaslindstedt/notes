import { describe, expect, it } from "vitest";

import {
  type FloatingPlacement,
  computeFloatingRect,
} from "../../src/ui/hooks/useFloatingPosition.ts";

function rectAt(top: number, height = 32, left = 100, width = 200): DOMRect {
  return {
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON() {
      return {};
    },
  };
}

const VIEWPORT_PLACEMENT: FloatingPlacement = {
  width: { kind: "min", minPx: 224 },
  anchor: "right",
  coordinateSpace: "viewport",
};

const DOCUMENT_PLACEMENT: FloatingPlacement = {
  width: { kind: "max", maxPx: 280 },
  anchor: "left",
  coordinateSpace: "document",
};

const PHONE_WINDOW = {
  innerWidth: 390,
  innerHeight: 844,
  scrollX: 0,
  scrollY: 0,
};

describe("computeFloatingRect", () => {
  it("places the panel just below the trigger with no keyboard", () => {
    const result = computeFloatingRect(
      rectAt(400),
      VIEWPORT_PLACEMENT,
      { offsetTop: 0, height: 844 },
      PHONE_WINDOW,
    );
    expect(result.top).toBe(400 + 32 + 4); // rect.bottom + gap
    expect(result.maxHeight).toBe(844 - 436 - 8);
  });

  it("keeps the panel below the trigger when there's room below the keyboard line", () => {
    const triggerBottom = 532;
    const result = computeFloatingRect(
      rectAt(500),
      VIEWPORT_PLACEMENT,
      { offsetTop: 470, height: 340 },
      PHONE_WINDOW,
    );
    expect(result.top).toBe(triggerBottom + 4);
  });

  it("pulls the panel down when the trigger is above the visible region", () => {
    const result = computeFloatingRect(
      rectAt(200),
      VIEWPORT_PLACEMENT,
      { offsetTop: 400, height: 340 },
      PHONE_WINDOW,
    );
    // Clamped to visibleTop + margin = 400 + 8 = 408
    expect(result.top).toBe(408);
    // maxHeight = visibleBottom (740) - top (408) - margin (8) = 324
    expect(result.maxHeight).toBe(324);
  });

  it("returns a usable maxHeight when the keyboard takes most of the space", () => {
    const result = computeFloatingRect(
      rectAt(20),
      VIEWPORT_PLACEMENT,
      { offsetTop: 0, height: 200 },
      PHONE_WINDOW,
    );
    expect(result.top).toBe(56); // 20 + 32 + 4
    expect(result.maxHeight).toBeGreaterThanOrEqual(120);
  });

  it("uses document-space scroll offsets for absolute-positioned popovers", () => {
    const result = computeFloatingRect(
      rectAt(200),
      DOCUMENT_PLACEMENT,
      { offsetTop: 0, height: 600 },
      { ...PHONE_WINDOW, scrollY: 1000 },
    );
    // top = rect.bottom (232) + gap (4) + scrollY (1000) = 1236
    expect(result.top).toBe(1236);
  });

  it("flips the panel upward when there isn't enough room below the trigger", () => {
    const result = computeFloatingRect(
      rectAt(780, 32), // trigger.bottom = 812 in an 844 viewport
      VIEWPORT_PLACEMENT,
      { offsetTop: 0, height: 844 },
      PHONE_WINDOW,
    );
    expect(result.placement).toBe("above");
    expect(result.top).toBe(776); // trigger.top (780) - gap (4)
    expect(result.maxHeight).toBe(768); // 780 - 0 - 4 - 8
  });

  it("stays below when there's at least the useful-height threshold of room", () => {
    const result = computeFloatingRect(
      rectAt(600, 32), // 844 - 632 = 212 > 180 (MIN_USEFUL_BELOW)
      VIEWPORT_PLACEMENT,
      { offsetTop: 0, height: 844 },
      PHONE_WINDOW,
    );
    expect(result.placement).toBe("below");
    expect(result.top).toBe(636);
  });

  it("flips the document-coord popover upward too, in document space", () => {
    const result = computeFloatingRect(
      rectAt(540, 40), // viewport trigger.bottom = 580, in a 600 visible region
      DOCUMENT_PLACEMENT,
      { offsetTop: 0, height: 600 },
      { ...PHONE_WINDOW, scrollY: 1000 },
    );
    expect(result.placement).toBe("above");
    // top = trigger.top (540) - gap (4) + scrollY (1000) = 1536
    expect(result.top).toBe(1536);
  });
});
