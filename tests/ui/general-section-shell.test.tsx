// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { drain, resetBus, unlock } from "../../src/achievements/bus.ts";
import { isStandaloneMobile } from "../../src/pwa/standalone.ts";
import { GeneralSection } from "../../src/ui/settings/GeneralSection.tsx";
import { NavContext, type NavContextValue } from "../../src/ui/nav-context.ts";
import { DEFAULT_APPEARANCE } from "../../src/theme/useTheme.ts";

// The phone app's WebView is the native shell the framework recognizes: it is
// no installed PWA (no `display-mode: standalone`), but it has no browser
// chrome either, so the edge-swipe setting belongs there. Unlike
// `general-section.test.tsx`, nothing here is mocked — the gate is the
// framework's own detector, reached through the app's re-export.

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

function onPhone() {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(IPHONE_UA);
}

function renderSection() {
  const value: NavContextValue = {
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
  render(
    <NavContext.Provider value={value}>
      <GeneralSection appearance={DEFAULT_APPEARANCE} onUpdate={vi.fn()} />
    </NavContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  resetBus();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as { ReactNativeWebView?: unknown }).ReactNativeWebView;
  delete (window as { __ossShell?: unknown }).__ossShell;
});

describe("the edge-swipe setting in the phone app's shell", () => {
  it("is hidden in a phone's browser tab", () => {
    onPhone();
    renderSection();
    expect(screen.queryByRole("radio", { name: "Right-swipe" })).toBeNull();
  });

  it("is offered when the react-native-webview bridge is present", () => {
    onPhone();
    (window as { ReactNativeWebView?: unknown }).ReactNativeWebView = {
      postMessage: vi.fn(),
    };
    renderSection();
    expect(screen.getByRole("radio", { name: "Right-swipe" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Floating button" })).toBeTruthy();
  });

  it("is offered when a shell injects its descriptor", () => {
    onPhone();
    (window as { __ossShell?: unknown }).__ossShell = {
      version: 1,
      capabilities: [],
    };
    renderSection();
    expect(screen.getByRole("radio", { name: "Right-swipe" })).toBeTruthy();
  });
});

describe("the home-screen trophy in the phone app", () => {
  it("never fires in the embedded build, though the shell counts as standalone", () => {
    onPhone();
    (window as { ReactNativeWebView?: unknown }).ReactNativeWebView = {
      postMessage: vi.fn(),
    };
    vi.stubGlobal("__EMBEDDED__", true);
    // App's mount effect: `if (isStandaloneMobile()) unlock("homeScreen")`.
    expect(isStandaloneMobile()).toBe(true);
    unlock("homeScreen");
    expect(drain()).toEqual([]);
  });
});
