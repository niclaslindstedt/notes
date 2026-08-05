// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearLogs, getLogs } from "../../src/dev/logger.ts";
import { ErrorBoundary } from "../../src/ui/ErrorBoundary.tsx";

function Boom(): never {
  throw new Error("kaboom");
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
});
