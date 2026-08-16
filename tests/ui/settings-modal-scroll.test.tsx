// @vitest-environment jsdom
import { render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import type { UseStorageBackend } from "../../src/storage/useStorageBackend.ts";
import { NavContext, type NavContextValue } from "../../src/ui/nav-context.ts";
import type { EncryptionConversionState } from "../../src/ui/settings/EncryptionLogModal.tsx";
import { SettingsModal } from "../../src/ui/settings/SettingsModal.tsx";

// The dialog's scrolling panel has to establish a containing block, and the
// reason is not cosmetic. Every Checkbox / ToggleRow hides its real `<input>`
// with `sr-only`, which is `position: absolute` — so without `relative` here
// those inputs resolve against the Modal card instead. That put them outside
// this panel's clip: they inflated the *card's* scroll height, and focusing
// one (which is exactly what tapping a toggle does) scrolled the card to
// reveal it. The card is `overflow: hidden`, so nothing scrolled it back and
// the whole dialog went blank until it was reopened.
//
// jsdom has no layout engine, so the geometry itself can't be asserted here —
// what this pins is the class that prevents it, on the element that needs it.
const NAV: NavContextValue = {
  open: false,
  toggle: vi.fn(),
  close: vi.fn(),
  setDragging: vi.fn(),
  position: { side: "left", y: 0.5 },
  setPosition: vi.fn(),
  showMenuButton: true,
  setShowMenuButton: vi.fn(),
  showButton: true,
  pinned: false,
  sidebarCollapsed: false,
  toggleSidebar: vi.fn(),
};

// Only the Storage and Transform tabs read these, and the dialog opens on
// General — so the tabs under test never touch them.
const STORAGE = {} as unknown as UseStorageBackend;
const CONVERSION = {} as unknown as EncryptionConversionState;

describe("the settings dialog's scrolling panel", () => {
  it("contains the visually-hidden inputs its toggles focus", () => {
    render(
      <NavContext.Provider value={NAV}>
        <SettingsModal
          open
          onClose={vi.fn()}
          storage={STORAGE}
          conversion={CONVERSION}
        />
      </NavContext.Provider>,
    );
    const panel = screen.getByRole("tabpanel");
    expect(panel.className).toContain("overflow-y-auto");
    expect(panel.className).toContain("relative");
  });
});
