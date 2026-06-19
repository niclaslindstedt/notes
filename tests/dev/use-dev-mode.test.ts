// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { isCaptureEnabled } from "../../src/dev/logger.ts";
import { useDevMode } from "../../src/dev/useDevMode.ts";

afterEach(() => {
  // Reset module-scope state between tests — turning dev mode off also forces
  // capture off, which is exactly the invariant under test.
  const { result } = renderHook(() => useDevMode());
  act(() => result.current.setDevMode(false));
  localStorage.clear();
});

describe("useDevMode", () => {
  it("defaults both flags off", () => {
    const { result } = renderHook(() => useDevMode());
    expect(result.current.devMode).toBe(false);
    expect(result.current.captureLogs).toBe(false);
  });

  it("turns developer mode on and persists it", () => {
    const { result } = renderHook(() => useDevMode());
    act(() => result.current.setDevMode(true));
    expect(result.current.devMode).toBe(true);
    expect(localStorage.getItem("notes:dev:mode")).toBe("true");
  });

  it("captures logs through to the logger when enabled", () => {
    const { result } = renderHook(() => useDevMode());
    act(() => result.current.setDevMode(true));
    act(() => result.current.setCaptureLogs(true));
    expect(result.current.captureLogs).toBe(true);
    expect(isCaptureEnabled()).toBe(true);
  });

  it("forces log capture off when developer mode is turned off", () => {
    const { result } = renderHook(() => useDevMode());
    act(() => result.current.setDevMode(true));
    act(() => result.current.setCaptureLogs(true));
    expect(isCaptureEnabled()).toBe(true);

    act(() => result.current.setDevMode(false));
    expect(result.current.devMode).toBe(false);
    expect(result.current.captureLogs).toBe(false);
    expect(isCaptureEnabled()).toBe(false);
  });
});
