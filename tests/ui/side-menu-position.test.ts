import { describe, expect, it } from "vitest";

import {
  clampRect,
  clampUnit,
  rectToPosition,
  restingRect,
  type MenuButtonPosition,
} from "../../src/ui/sideMenuPosition.ts";

// Pure snap/clamp geometry for the draggable floating menu button — no
// React, no DOM — so it's the cheap layer to cover. A 400×800 viewport
// with the default 44px button and 12px margin is used throughout.
const VW = 400;
const VH = 800;

describe("clampUnit", () => {
  it("clamps into [0, 1] and coerces non-finite to 0", () => {
    expect(clampUnit(-0.5)).toBe(0);
    expect(clampUnit(0.25)).toBe(0.25);
    expect(clampUnit(2)).toBe(1);
    expect(clampUnit(Number.NaN)).toBe(0);
  });
});

describe("restingRect", () => {
  it("rests against the left margin on the left side", () => {
    const rect = restingRect({ side: "left", y: 0 }, VW, VH);
    expect(rect.left).toBe(12);
    expect(rect.top).toBe(12);
  });

  it("rests against the right margin on the right side", () => {
    const rect = restingRect({ side: "right", y: 1 }, VW, VH);
    expect(rect.left).toBe(VW - 12 - 44);
    // y=1 → the bottom of the available vertical travel.
    expect(rect.top).toBe(VH - 12 - 44);
  });
});

describe("clampRect", () => {
  it("keeps a free-dragged point inside the margin-inset box", () => {
    const rect = clampRect(-100, 5000, VW, VH);
    expect(rect.left).toBe(12);
    expect(rect.top).toBe(VH - 12 - 44);
  });
});

describe("rectToPosition", () => {
  it("snaps to the nearer edge and records the vertical fraction", () => {
    // Centre near the left edge → snaps left; halfway down → y ≈ 0.5.
    const mid = restingRect({ side: "left", y: 0.5 }, VW, VH);
    const pos: MenuButtonPosition = rectToPosition(mid.left, mid.top, VW, VH);
    expect(pos.side).toBe("left");
    expect(pos.y).toBeCloseTo(0.5, 5);
  });

  it("snaps a point past the horizontal midpoint to the right edge", () => {
    const pos = rectToPosition(VW - 20, 12, VW, VH);
    expect(pos.side).toBe("right");
    expect(pos.y).toBeCloseTo(0, 5);
  });
});
