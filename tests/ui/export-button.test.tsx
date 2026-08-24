// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/preact";
import type { ReactNode } from "react";

import type { Note } from "../../src/domain/note.ts";
import { ExportButton } from "../../src/ui/export/ExportButton.tsx";
import { NavContext, type NavContextValue } from "../../src/ui/nav-context.ts";

// The export work is loaded on the press (`await import("./export-note.ts")`),
// so the download tests swap the module in with `vi.doMock` *per test* — a
// hoisted `vi.mock` factory caches its first outcome for the whole file, and
// one test needs the factory to throw (a stale page asking for a chunk hash
// the latest deploy replaced) while the others need it to resolve.
const EXPORT_NOTE = "../../src/ui/export/export-note.ts";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(document, "execCommand");
  vi.restoreAllMocks();
  vi.doUnmock(EXPORT_NOTE);
  vi.resetModules();
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
  sidebarCollapsed: false,
  toggleSidebar: vi.fn(),
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

  it("raises a failure toast when the export chunk can't be fetched", async () => {
    // The deployed hashes churn under an open page (every push rebuilds the
    // /preview/ slot), so the on-press `import()` can 404. That used to escape
    // as an unhandled rejection — a console error and a button that silently
    // did nothing. The user must be told, and told the remedy: a reload gets a
    // fresh page whose chunk URLs match what the server actually has.
    vi.doMock(EXPORT_NOTE, () => {
      throw new TypeError(
        "Failed to fetch dynamically imported module: export-note-C5VSQ-9U.js",
      );
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(withNav(<ExportButton note={note} copyScope="body" />));
    openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Export to MD" }));
    });

    // The chunk resolves through the module runner, i.e. beyond the microtask
    // queue a single `act` pass flushes — poll for the toast instead.
    const toast = await screen.findByRole("status");
    expect(toast.textContent).toContain("Export failed");
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(warn).toHaveBeenCalled();
  });

  it("raises the failure toast when the PDF export reports defeat", async () => {
    // `exportPdf` swallows its own errors into `false` (a jsPDF chunk that
    // wouldn't load, a write that threw) — the button must not read that as
    // quiet success.
    vi.doMock(EXPORT_NOTE, () => ({
      exportPdf: vi.fn(() => Promise.resolve(false)),
      downloadMarkdown: vi.fn(),
    }));
    render(withNav(<ExportButton note={note} copyScope="body" />));
    openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Export to PDF" }));
    });

    const toast = await screen.findByRole("status");
    expect(toast.textContent).toContain("Export failed");
  });

  it("shows no toast when an export succeeds", async () => {
    const downloadMarkdown = vi.fn();
    vi.doMock(EXPORT_NOTE, () => ({
      exportPdf: vi.fn(() => Promise.resolve(true)),
      downloadMarkdown,
    }));
    render(withNav(<ExportButton note={note} copyScope="body" />));
    openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Export to MD" }));
    });

    await waitFor(() => expect(downloadMarkdown).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
