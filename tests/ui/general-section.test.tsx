// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GeneralSection } from "../../src/ui/settings/GeneralSection.tsx";
import { NavContext, type NavContextValue } from "../../src/ui/nav-context.ts";
import { useStandaloneMobile } from "../../src/pwa/standalone.ts";
import {
  getAppearance,
  setDisableAchievements,
} from "../../src/theme/useTheme.ts";

// The menu-activation control is only offered in the installed PWA on a
// phone / tablet, so the standalone detector is mocked per test.
vi.mock("../../src/pwa/standalone.ts", () => ({
  useStandaloneMobile: vi.fn(() => false),
}));

const mockStandalone = vi.mocked(useStandaloneMobile);

function renderWithNav(overrides: Partial<NavContextValue> = {}) {
  const setShowMenuButton = vi.fn();
  const value: NavContextValue = {
    open: false,
    toggle: vi.fn(),
    close: vi.fn(),
    setDragging: vi.fn(),
    position: { side: "left", y: 0.5 },
    setPosition: vi.fn(),
    showMenuButton: true,
    setShowMenuButton,
    showButton: true,
    pinned: false,
    ...overrides,
  };
  render(
    <NavContext.Provider value={value}>
      <GeneralSection />
    </NavContext.Provider>,
  );
  return { setShowMenuButton };
}

describe("GeneralSection", () => {
  afterEach(() => {
    mockStandalone.mockReturnValue(false);
    setDisableAchievements(false);
  });

  it("offers a flag button per supported language", () => {
    renderWithNav();
    expect(screen.getByRole("radio", { name: "English" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Svenska" })).toBeTruthy();
  });

  it("toggles the achievements system off", () => {
    renderWithNav();
    const toggle = screen.getByLabelText("Disable achievements");
    expect(toggle).toBeTruthy();
    // Off by default (achievements on); ticking it disables the system.
    fireEvent.click(toggle);
    expect(getAppearance().disableAchievements).toBe(true);
  });

  it("hides the menu-activation control outside a standalone mobile PWA", () => {
    mockStandalone.mockReturnValue(false);
    renderWithNav();
    expect(screen.queryByRole("radio", { name: "Floating button" })).toBeNull();
  });

  it("offers the menu-activation segmented control in a standalone mobile PWA", () => {
    mockStandalone.mockReturnValue(true);
    const { setShowMenuButton } = renderWithNav({ showMenuButton: true });
    const swipe = screen.getByRole("radio", { name: "Right-swipe" });
    const button = screen.getByRole("radio", { name: "Floating button" });
    expect(button.getAttribute("aria-checked")).toBe("true");
    expect(swipe.getAttribute("aria-checked")).toBe("false");
    // Picking the edge swipe turns the floating button off.
    fireEvent.click(swipe);
    expect(setShowMenuButton).toHaveBeenCalledWith(false);
  });
});
