import { describe, expect, it } from "vitest";

import { revealScrollTop } from "../../src/ui/reveal-scroll.ts";

// A 400px list of 40px rows, scrolled to the top unless a test says otherwise.
const ROW = 40;
const view = (top = 0) => ({ top, height: 400 });
const row = (index: number) => ({ top: index * ROW, height: ROW });

describe("revealScrollTop", () => {
  it("leaves a row that is already on screen, with its neighbour, alone", () => {
    expect(revealScrollTop(view(), row(3), ROW)).toBeNull();
  });

  it("scrolls a row below the fold up until the row after it shows too", () => {
    // Row 12 spans 480–520; with the next row below it the view must end at 560.
    expect(revealScrollTop(view(), row(12), ROW)).toBe(560 - 400);
  });

  it("scrolls when the row is visible but the one after it isn't", () => {
    // Row 9 (360–400) sits flush with the bottom edge; row 10 is off screen.
    expect(revealScrollTop(view(), row(9), ROW)).toBe(40);
  });

  it("scrolls up to a row above the view, keeping the row before it", () => {
    expect(revealScrollTop(view(800), row(5), ROW)).toBe(160);
  });

  it("never asks for a negative scroll at the top of the list", () => {
    expect(revealScrollTop(view(200), row(0), ROW)).toBe(0);
  });

  it("keeps the row's top in view when row and context outgrow the view", () => {
    expect(revealScrollTop({ top: 0, height: 60 }, row(5), ROW)).toBe(200);
  });
});
