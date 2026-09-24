// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { capabilities, platform } from "../../src/platform/capabilities.ts";

/**
 * jsdom serves the page from `http://localhost/` and exposes no
 * `showDirectoryPicker`, so each test states only the surface it cares about
 * and restores it afterwards.
 */
function setProtocol(protocol: string, hostname = "localhost") {
  const url = `${protocol}//${hostname}/index.html`;
  window.history.replaceState(null, "", "/");
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, protocol, hostname, href: url },
  });
}

const originalLocation = window.location;

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
  delete (window as unknown as Record<string, unknown>).showDirectoryPicker;
  delete (window as unknown as Record<string, unknown>).ReactNativeWebView;
  delete (window as unknown as Record<string, unknown>).__ossAuthSession;
});

describe("platform", () => {
  it("is web in an ordinary browser tab", () => {
    expect(platform()).toBe("web");
  });

  it("is desktop behind the Tauri shell's private scheme", () => {
    setProtocol("notes:");
    expect(platform()).toBe("desktop");
  });

  // WebView2 maps the registered scheme onto `http://notes.localhost`, so on
  // Windows the protocol says nothing and the host is the tell.
  it("is desktop on Windows, where the scheme becomes a localhost host", () => {
    setProtocol("http:", "notes.localhost");
    expect(platform()).toBe("desktop");
  });

  it("is still web on a plain localhost dev server", () => {
    setProtocol("http:", "localhost");
    expect(platform()).toBe("web");
  });

  it("is native inside the React Native WebView wrapper", () => {
    (window as unknown as Record<string, unknown>).ReactNativeWebView = {
      postMessage: () => {},
    };
    expect(platform()).toBe("native");
  });

  // The wrapper injects `ReactNativeWebView` into a page it may also be
  // serving from a local scheme; the native answer has to win, because it is
  // the one that decides whether the pinned fetch exists.
  it("prefers native over the scheme check when both look true", () => {
    setProtocol("notes:");
    (window as unknown as Record<string, unknown>).ReactNativeWebView = {
      postMessage: () => {},
    };
    expect(platform()).toBe("native");
  });
});

describe("capabilities", () => {
  it("offers redirect OAuth on the web but not on the desktop", () => {
    expect(capabilities().redirectOauth).toBe(true);
    setProtocol("notes:");
    expect(capabilities().redirectOauth).toBe(false);
  });

  // The two are complementary by construction, and have to stay that way: a
  // surface with neither can never connect a cloud backend at all.
  it("offers the loopback redirect only on the desktop, where the redirect cannot land", () => {
    expect(capabilities()).toMatchObject({
      redirectOauth: true,
      loopbackOauth: false,
    });
    setProtocol("notes:");
    expect(capabilities()).toMatchObject({
      redirectOauth: false,
      loopbackOauth: true,
    });
  });

  // The wrapper loads the page over `file://`: no origin a provider would
  // redirect to, and no socket to listen on. What it offers instead is an
  // authentication session, found by presence.
  it("withholds the redirect and the loopback from the native wrapper", () => {
    setProtocol("file:", "");
    (window as unknown as Record<string, unknown>).ReactNativeWebView = {
      postMessage: () => {},
    };
    expect(capabilities()).toMatchObject({
      redirectOauth: false,
      loopbackOauth: false,
      authSessionOauth: false,
    });
  });

  it("offers auth-session OAuth wherever a sign-in host is installed, and nowhere else", () => {
    expect(capabilities().authSessionOauth).toBe(false);
    (window as unknown as Record<string, unknown>).__ossAuthSession = {
      version: 1,
      redirectUri: "se.agilator.notes://oauth",
      open: () => Promise.resolve(null),
    };
    expect(capabilities().authSessionOauth).toBe(true);
    // A host of a version the framework does not speak is no host.
    (window as unknown as Record<string, unknown>).__ossAuthSession = {
      version: 2,
      redirectUri: "se.agilator.notes://oauth",
      open: () => Promise.resolve(null),
    };
    expect(capabilities().authSessionOauth).toBe(false);
  });

  it("offers the pinned fetch only inside the native wrapper", () => {
    expect(capabilities().pinnedFetch).toBe(false);
    (window as unknown as Record<string, unknown>).ReactNativeWebView = {
      postMessage: () => {},
    };
    expect(capabilities().pinnedFetch).toBe(true);
  });

  it("follows the File System Access API for the folder picker", () => {
    expect(capabilities().folderPicker).toBe(false);
    (window as unknown as Record<string, unknown>).showDirectoryPicker =
      () => {};
    expect(capabilities().folderPicker).toBe(true);
  });

  // On Windows the desktop shell's webview is Chromium (WebView2), so the
  // folder backend stays available there — losing redirect OAuth must not be
  // read as losing sync altogether.
  it("keeps the folder picker on the desktop", () => {
    setProtocol("notes:");
    (window as unknown as Record<string, unknown>).showDirectoryPicker =
      () => {};
    expect(capabilities()).toMatchObject({
      folderPicker: true,
      redirectOauth: false,
    });
  });
});
