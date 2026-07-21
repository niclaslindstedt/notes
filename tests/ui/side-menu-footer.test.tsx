// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SideMenuFooter } from "../../src/ui/SideMenuFooter.tsx";
import { ModalBusContext, type ModalCommand } from "../../src/ui/modal-bus.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// `useModalDispatch` throws outside a bus provider; `useT` and `useAppearance`
// fall back to defaults on their own. Wrap the footer in a bus whose dispatch
// we can observe.
function renderFooter(onClose = vi.fn()) {
  const dispatch = vi.fn<(command: ModalCommand) => void>();
  render(
    <ModalBusContext.Provider
      value={{ dispatch, active: null, close: vi.fn() }}
    >
      <SideMenuFooter onClose={onClose} />
    </ModalBusContext.Provider>,
  );
  return { onClose, dispatch };
}

describe("SideMenuFooter", () => {
  it("hides the donate link when no donate URL is configured", () => {
    vi.stubEnv("VITE_DONATE_URL", "");
    renderFooter();
    expect(screen.queryByText("Donate")).toBeNull();
  });

  it("shows the donate link, pointing at the configured URL, and closes the drawer on click", () => {
    vi.stubEnv("VITE_DONATE_URL", "https://donate.example");
    const { onClose } = renderFooter();
    const donate = screen.getByText("Donate").closest("a");
    expect(donate?.getAttribute("href")).toBe("https://donate.example");
    expect(donate?.getAttribute("target")).toBe("_blank");
    fireEvent.click(donate!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens the settings modal and closes the drawer behind it", () => {
    const { onClose, dispatch } = renderFooter();
    fireEvent.click(screen.getByText("Settings"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ kind: "settings" });
  });

  it("toggles the About dropdown open, revealing the project links", () => {
    renderFooter();
    const about = screen.getByRole("menuitem", { name: "About" });
    expect(about.getAttribute("aria-expanded")).toBe("false");
    // The project links live behind the dropdown, so they aren't shown yet.
    expect(screen.queryByText("Source")).toBeNull();

    fireEvent.click(about);
    expect(about.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Source")).toBeTruthy();
    expect(screen.getByText("Privacy")).toBeTruthy();
  });

  it("links source to the repository and privacy to the in-slot /privacy page", () => {
    renderFooter();
    fireEvent.click(screen.getByRole("menuitem", { name: "About" }));

    const source = screen.getByText("Source").closest("a");
    expect(source?.getAttribute("href")).toBe(
      "https://github.com/niclaslindstedt/notes",
    );
    expect(source?.getAttribute("target")).toBe("_blank");

    const privacy = screen.getByText("Privacy").closest("a");
    // BASE_URL carries the trailing slash; in tests it resolves to "/".
    expect(privacy?.getAttribute("href")).toBe("/privacy");
    // Privacy is a same-origin page, not an external link.
    expect(privacy?.getAttribute("target")).toBeNull();
  });

  it("closes the drawer and collapses About when a project link is followed", () => {
    const { onClose } = renderFooter();
    const about = screen.getByRole("menuitem", { name: "About" });
    fireEvent.click(about);
    fireEvent.click(screen.getByText("Source"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(about.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens the changelog modal from the About dropdown and closes both", () => {
    const { onClose, dispatch } = renderFooter();
    fireEvent.click(screen.getByRole("menuitem", { name: "About" }));
    fireEvent.click(screen.getByText("What's new"));
    expect(dispatch).toHaveBeenCalledWith({ kind: "changelog" });
    expect(onClose).toHaveBeenCalledTimes(1);
    // The About trigger collapses again after picking a link.
    const about = screen.getByRole("menuitem", { name: "About" });
    expect(about.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders the achievements entry between donate and settings", () => {
    renderFooter();
    // Default appearance leaves achievements enabled, so the row shows. Its
    // label is the quiet "open" copy when nothing is unseen.
    expect(screen.getByRole("menuitem", { name: "Achievements" })).toBeTruthy();
  });

  // Edge-to-edge PWA: the drawer reserves no bottom safe-area inset, so the
  // footer owns its own breathing room and carries an extra 10px below the last
  // row (Settings) to stay a comfortable thumb reach above the screen edge.
  it("carries an extra 10px of thumb clearance below its last row", () => {
    renderFooter();
    const footer = screen
      .getByRole("menuitem", { name: "Settings" })
      .closest('[class*="padding-bottom:calc(1.25rem"]');
    expect(footer?.className).toContain(
      "padding-bottom:calc(1.25rem_-_var(--density-row-py)_+_10px)",
    );
  });
});
