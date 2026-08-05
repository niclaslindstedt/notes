// @vitest-environment jsdom
import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearLogs, createLogger, getLogs } from "../../src/dev/logger.ts";
import { ErrorBoundary } from "../../src/ui/ErrorBoundary.tsx";

function Boom(): never {
  throw new Error("kaboom");
}

// Stub the async Clipboard API `writeClipboard` prefers, and hand back what it
// was asked to write.
function stubClipboard() {
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    clearLogs();
    // React logs a caught error to the console itself; silence it so the run
    // isn't littered with the stack this test is deliberately provoking.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders its children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>notes</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("notes")).toBeTruthy();
  });

  it("shows a recoverable screen instead of unmounting the app", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reload the app/ })).toBeTruthy();
  });

  it("reloads the app when the button is pressed", () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Reload the app/ }));
    expect(reload).toHaveBeenCalled();
  });

  // The crash goes to the in-app log rather than the console: on the phone
  // where a blank screen hurts most, devtools aren't reachable, and the entry
  // survives the reload so it can be read back from Settings → Logs.
  it("logs the crash so it can be read back after the reload", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    const entry = getLogs().find((l) => l.scope === "crash");
    expect(entry?.level).toBe("error");
    expect(entry?.message).toContain("kaboom");
  });

  // The screen renders outside the app shell, and `html, body` are locked to
  // `overflow: hidden` so the document itself never scrolls — a block in
  // document flow simply had anything past the fold clipped away. It has to
  // pin itself to the viewport and scroll inside, clear of the notch and the
  // home indicator the way every modal is.
  it("pins itself to the viewport, scrolls its own content, and insets for the safe areas", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    const sheet = screen.getByRole("alert");
    expect(sheet.className).toContain("fixed inset-0");
    expect(sheet.className).toContain("overflow-y-auto");
    for (const edge of ["top", "right", "bottom", "left"]) {
      expect(sheet.className).toContain(`env(safe-area-inset-${edge})`);
    }
  });

  // The component stack is usually the half of the report that says *which*
  // surface threw, so it is shown (and copied) alongside the error's own stack.
  it("shows the component stack alongside the error", () => {
    const { container } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    const details = container.querySelector("pre")!;
    expect(details.textContent).toContain("kaboom");
    expect(details.textContent).toContain("Boom");
  });

  // Settings → Logs lives inside the app this screen has replaced, so without
  // a copy button the only way to report a phone-only crash was to transcribe
  // the stack off the screen by hand.
  it("copies the crash and the recent log to the clipboard", async () => {
    const writeText = stubClipboard();
    createLogger("dropbox").info("load start");
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy report/ }));
    });
    const report = writeText.mock.calls[0]![0];
    expect(report).toContain("kaboom");
    expect(report).toContain("[dropbox] INFO load start");
    expect(screen.getByRole("button", { name: /Copied/ })).toBeTruthy();
  });

  it("says so when the clipboard refuses", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy report/ }));
    });
    expect(screen.getByRole("button", { name: /Copy failed/ })).toBeTruthy();
  });
});
