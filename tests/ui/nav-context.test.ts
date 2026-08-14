import { describe, expect, it } from "vitest";

import {
  dockedSidebarWidth,
  SIDEBAR_RAIL_WIDTH,
  type NavContextValue,
} from "../../src/ui/nav-context.ts";

// Only the three fields the width helper reads matter here; the rest of the
// nav value is inert for this question.
function nav(over: Partial<NavContextValue>): NavContextValue {
  return {
    open: false,
    toggle: () => {},
    close: () => {},
    setDragging: () => {},
    position: { side: "left", y: 0.5 },
    setPosition: () => {},
    showMenuButton: true,
    setShowMenuButton: () => {},
    showButton: true,
    pinned: false,
    sidebarCollapsed: false,
    toggleSidebar: () => {},
    ...over,
  };
}

describe("dockedSidebarWidth", () => {
  it("is undefined without a docked sidebar, so overlays keep their gutter", () => {
    expect(dockedSidebarWidth(nav({ pinned: false }))).toBeUndefined();
    // A stale collapsed flag on a phone must not inset anything either.
    expect(
      dockedSidebarWidth(nav({ pinned: false, sidebarCollapsed: true })),
    ).toBeUndefined();
  });

  it("counts the panel and its rail while the sidebar is docked open", () => {
    const width = dockedSidebarWidth(nav({ pinned: true }));
    expect(width).toBe("calc(16rem + 1rem)");
  });

  it("shrinks to the bare rail once the sidebar is folded away", () => {
    expect(
      dockedSidebarWidth(nav({ pinned: true, sidebarCollapsed: true })),
    ).toBe(SIDEBAR_RAIL_WIDTH);
  });
});
