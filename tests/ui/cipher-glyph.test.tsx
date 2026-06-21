// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CipherGlyph } from "../../src/ui/CipherGlyph.tsx";

const CIPHER_CHARS = "0123456789ABCDEF#$%&";

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion") ? reduce : false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.documentElement.removeAttribute("data-reduce-motion");
});

describe("cipher glyph", () => {
  it("renders a hidden run of cipher characters", () => {
    mockReducedMotion(false);
    const { container } = render(<CipherGlyph />);
    const span = container.querySelector("span")!;
    expect(span.getAttribute("aria-hidden")).toBe("true");
    expect(span.textContent).toHaveLength(5);
    for (const ch of span.textContent!) {
      expect(CIPHER_CHARS).toContain(ch);
    }
  });

  it("scrambles over time when motion is allowed", () => {
    vi.useFakeTimers();
    mockReducedMotion(false);
    const { container } = render(<CipherGlyph />);
    const span = container.querySelector("span")!;
    const seen = new Set<string>();
    seen.add(span.textContent!);
    for (let i = 0; i < 40; i++) {
      act(() => {
        vi.advanceTimersByTime(110);
      });
      seen.add(span.textContent!);
    }
    // A couple of cells shift each tick, so 40 ticks should yield more than one
    // distinct frame.
    expect(seen.size).toBeGreaterThan(1);
  });

  it("holds a static frame under prefers-reduced-motion", () => {
    vi.useFakeTimers();
    mockReducedMotion(true);
    const { container } = render(<CipherGlyph />);
    const span = container.querySelector("span")!;
    const first = span.textContent;
    act(() => {
      vi.advanceTimersByTime(110 * 20);
    });
    expect(span.textContent).toBe(first);
  });

  it("freezes when the in-app reduce-motion toggle is on", () => {
    vi.useFakeTimers();
    mockReducedMotion(false);
    document.documentElement.setAttribute("data-reduce-motion", "true");
    const { container } = render(<CipherGlyph />);
    const span = container.querySelector("span")!;
    const first = span.textContent;
    act(() => {
      vi.advanceTimersByTime(110 * 20);
    });
    expect(span.textContent).toBe(first);
  });
});
