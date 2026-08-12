// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/preact";
import type { ReactNode } from "react";

import type { Note } from "../../src/domain/note.ts";
import { ExportButton } from "../../src/ui/export/ExportButton.tsx";
import { NavContext, type NavContextValue } from "../../src/ui/nav-context.ts";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(document, "execCommand");
  vi.restoreAllMocks();
});

const note: Note = {
  id: "n1",
  title: "Grocery list",
  body: "milk",
  createdAt: 0,
  updatedAt: 0,
};

// The toast reads the nav state to dock past a pinned sidebar, so the button
// needs a provider above it once the copy row has fired.
const nav: NavContextValue = {
  open: false,
  toggle: vi.fn(),
  close: vi.fn(),
  setDragging: vi.fn(),
  position: { side: "right", y: 0.5 },
  setPosition: vi.fn(),
  showMenuButton: true,
  setShowMenuButton: vi.fn(),
  showButton: true,
  pinned: false,
};

function withNav(children: ReactNode) {
  return <NavContext.Provider value={nav}>{children}</NavContext.Provider>;
}

/**
 * Give the copy path a clipboard that resolves or rejects. Defined onto the
 * real `navigator` rather than stubbed over it: a spread copy drops the
 * prototype getters the rest of the render reads.
 */
function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(writeText) },
    configurable: true,
  });
  // The `execCommand` fallback (an insecure origin) doesn't exist in jsdom;
  // spell out that it fails so the rejection path is the one under test.
  Object.defineProperty(document, "execCommand", {
    value: vi.fn(() => false),
    configurable: true,
  });
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
}

async function clickCopy() {
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy/ }));
  });
}

describe("ExportButton", () => {
  it("labels every row, so the menu is readable at a phone width", () => {
    // The rows were glyph-only below `sm:` once. There is room for the labels,
    // and three unexplained icons under the header is a guessing game.
    render(withNav(<ExportButton note={note} copyScope="body" />));
    openMenu();

    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
    expect(screen.getByText("Export to PDF")).toBeTruthy();
    expect(screen.getByText("Export to MD")).toBeTruthy();
    expect(screen.getByText("Copy to clipboard")).toBeTruthy();
  });

  it("raises a Copied toast when the clipboard row succeeds", async () => {
    stubClipboard(() => Promise.resolve());
    render(withNav(<ExportButton note={note} copyScope="body" />));
    openMenu();

    expect(screen.queryByRole("status")).toBeNull();
    await clickCopy();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("milk");
    // A `status` live region rather than an `alert`: it confirms something the
    // user just did, so it is read after the current utterance.
    expect(screen.getByRole("status").textContent).toBe("Copied");
  });

  it("stays silent when the clipboard write fails", async () => {
    // Nothing reached the clipboard, so a "Copied" would be a lie.
    stubClipboard(() => Promise.reject(new Error("denied")));
    render(withNav(<ExportButton note={note} copyScope="body" />));
    openMenu();
    await clickCopy();

    expect(screen.queryByRole("status")).toBeNull();
  });
});
