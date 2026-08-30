// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { unlock } from "../../src/achievements/index.ts";
import { useCloudBackend } from "../../src/storage/useCloudBackend.ts";

// The connect / boot paths fire the "cloudWalker" achievement; spy on it rather
// than draining the real bus.
vi.mock("../../src/achievements/index.ts", () => ({ unlock: vi.fn() }));

// The cloud tokens are persisted to localStorage; mock the preference module so
// the get/set/clear functions are controllable, spyable seams.
let dropboxTokenStore: string | null = null;
let dropboxRefreshStore: string | null = null;
let gdriveTokenStore: string | null = null;
const setDropboxToken = vi.fn((t: string) => {
  dropboxTokenStore = t;
});
const setDropboxRefreshToken = vi.fn((t: string) => {
  dropboxRefreshStore = t;
});
const setGdriveToken = vi.fn((t: string) => {
  gdriveTokenStore = t;
});
const clearDropboxToken = vi.fn(() => {
  dropboxTokenStore = null;
});
const clearDropboxRefreshToken = vi.fn(() => {
  dropboxRefreshStore = null;
});
const clearGdriveToken = vi.fn(() => {
  gdriveTokenStore = null;
});
vi.mock("../../src/storage/backend-preference.ts", () => ({
  getDropboxToken: () => dropboxTokenStore,
  getDropboxRefreshToken: () => dropboxRefreshStore,
  getGdriveToken: () => gdriveTokenStore,
  setDropboxToken: (t: string) => setDropboxToken(t),
  setDropboxRefreshToken: (t: string) => setDropboxRefreshToken(t),
  setGdriveToken: (t: string) => setGdriveToken(t),
  clearDropboxToken: () => clearDropboxToken(),
  clearDropboxRefreshToken: () => clearDropboxRefreshToken(),
  clearGdriveToken: () => clearGdriveToken(),
}));

// Dropbox / Google Drive OAuth performs real redirects / network I/O; stub each
// entry point so the verbs and the boot effect can be driven deterministically.
const startDropboxAuth = vi.fn(async () => {});
const hasPendingDropboxAuth = vi.fn(() => false);
const completeDropboxAuth = vi.fn();
const connectDropboxLoopback = vi.fn();
vi.mock("../../src/storage/dropbox/index.ts", () => ({
  startDropboxAuth: () => startDropboxAuth(),
  completeDropboxAuth: (code: string) => completeDropboxAuth(code),
  connectDropboxLoopback: () => connectDropboxLoopback(),
}));

// `connectDropbox` picks its flow shape from the surface. jsdom is a browser
// tab, so the redirect path is the default; the desktop tests below flip this.
let loopbackOauth = false;
vi.mock("../../src/platform/capabilities.ts", () => ({
  capabilities: () => ({
    folderPicker: false,
    redirectOauth: !loopbackOauth,
    loopbackOauth,
    pinnedFetch: false,
  }),
}));
// `hasPendingDropboxAuth` lives in its own module so the boot probe can answer
// without pulling the adapter into the first paint — mock it there.
vi.mock("../../src/storage/dropbox/pending.ts", () => ({
  hasPendingDropboxAuth: () => hasPendingDropboxAuth(),
}));

const startGdriveAuth = vi.fn();
vi.mock("../../src/storage/gdrive/index.ts", () => ({
  startGdriveAuth: () => startGdriveAuth(),
}));

// Drive `?code=` boot redirects without navigating: rewrite the search string
// and capture the replaceState the URL-cleaning helper issues.
function setSearch(search: string): void {
  window.history.replaceState(null, "", `/${search}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  dropboxTokenStore = null;
  dropboxRefreshStore = null;
  gdriveTokenStore = null;
  hasPendingDropboxAuth.mockReturnValue(false);
  loopbackOauth = false;
  setSearch("");
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("useCloudBackend", () => {
  it("seeds token state from the persisted preference", () => {
    dropboxTokenStore = "dbx-tok";
    dropboxRefreshStore = "dbx-ref";
    gdriveTokenStore = "gd-tok";
    const selectBackend = vi.fn();
    const { result } = renderHook(() => useCloudBackend({ selectBackend }));
    expect(result.current.dropboxToken).toBe("dbx-tok");
    expect(result.current.dropboxRefresh).toBe("dbx-ref");
    expect(result.current.gdriveToken).toBe("gd-tok");
  });

  it("connectDropbox kicks off the OAuth redirect and switches nothing yet", async () => {
    const selectBackend = vi.fn();
    const { result } = renderHook(() => useCloudBackend({ selectBackend }));
    act(() => result.current.connectDropbox());
    // The Dropbox backend is fetched on the connect rather than at boot, so
    // the redirect starts a microtask later. Harmless here — it is a full-page
    // redirect, not a popup that a blocker could tie to the click.
    await waitFor(() => expect(startDropboxAuth).toHaveBeenCalledTimes(1));
    // Completion only lands in the boot effect after the redirect returns.
    expect(selectBackend).not.toHaveBeenCalled();
  });

  // The desktop cannot complete a redirect back to `notes://app`, so the same
  // verb runs the loopback flow instead — and unlike the redirect, it finishes
  // in place, so everything the boot effect would have done happens here.
  it("connectDropbox runs the loopback flow and finishes in place on the desktop", async () => {
    loopbackOauth = true;
    connectDropboxLoopback.mockResolvedValue({
      accessToken: "dbx-loop",
      refreshToken: "dbx-loop-ref",
    });
    const selectBackend = vi.fn();
    const { result } = renderHook(() => useCloudBackend({ selectBackend }));

    await act(async () => {
      await result.current.connectDropbox();
    });

    expect(connectDropboxLoopback).toHaveBeenCalledTimes(1);
    // The redirect flow is the one thing that must NOT happen here — it would
    // navigate the shell to a page with no way back.
    expect(startDropboxAuth).not.toHaveBeenCalled();
    expect(setDropboxToken).toHaveBeenCalledWith("dbx-loop");
    expect(setDropboxRefreshToken).toHaveBeenCalledWith("dbx-loop-ref");
    expect(result.current.dropboxToken).toBe("dbx-loop");
    expect(result.current.dropboxRefresh).toBe("dbx-loop-ref");
    expect(selectBackend).toHaveBeenCalledWith("dropbox");
    expect(unlock).toHaveBeenCalledWith("cloudWalker");
  });

  // There is no redirect to explain a silent failure on the desktop, so the
  // rejection has to reach the caller for the settings panel to show it.
  it("connectDropbox rejects on the desktop when the loopback flow fails", async () => {
    loopbackOauth = true;
    connectDropboxLoopback.mockRejectedValue(new Error("declined"));
    const selectBackend = vi.fn();
    const { result } = renderHook(() => useCloudBackend({ selectBackend }));

    await expect(result.current.connectDropbox()).rejects.toThrow("declined");
    expect(setDropboxToken).not.toHaveBeenCalled();
    expect(selectBackend).not.toHaveBeenCalled();
  });

  it("disconnectDropbox clears both tokens and falls back to the browser store", () => {
    dropboxTokenStore = "dbx-tok";
    dropboxRefreshStore = "dbx-ref";
    const selectBackend = vi.fn();
    const { result } = renderHook(() => useCloudBackend({ selectBackend }));
    act(() => result.current.disconnectDropbox());
    expect(clearDropboxToken).toHaveBeenCalled();
    expect(clearDropboxRefreshToken).toHaveBeenCalled();
    expect(result.current.dropboxToken).toBeNull();
    expect(result.current.dropboxRefresh).toBeNull();
    expect(selectBackend).toHaveBeenCalledWith("browser");
  });

  it("connectGdrive stores the popup token, switches, and unlocks the achievement", async () => {
    startGdriveAuth.mockResolvedValue("gd-fresh");
    const selectBackend = vi.fn();
    const { result } = renderHook(() => useCloudBackend({ selectBackend }));
    await act(async () => {
      await result.current.connectGdrive();
    });
    expect(setGdriveToken).toHaveBeenCalledWith("gd-fresh");
    expect(result.current.gdriveToken).toBe("gd-fresh");
    expect(selectBackend).toHaveBeenCalledWith("gdrive");
    expect(unlock).toHaveBeenCalledWith("cloudWalker");
  });

  it("disconnectGdrive clears the token and falls back to the browser store", () => {
    gdriveTokenStore = "gd-tok";
    const selectBackend = vi.fn();
    const { result } = renderHook(() => useCloudBackend({ selectBackend }));
    act(() => result.current.disconnectGdrive());
    expect(clearGdriveToken).toHaveBeenCalled();
    expect(result.current.gdriveToken).toBeNull();
    expect(selectBackend).toHaveBeenCalledWith("browser");
  });

  it("rememberDropboxAccessToken persists and reflects a silently-refreshed token", () => {
    const selectBackend = vi.fn();
    const { result } = renderHook(() => useCloudBackend({ selectBackend }));
    act(() => result.current.rememberDropboxAccessToken("dbx-refreshed"));
    expect(setDropboxToken).toHaveBeenCalledWith("dbx-refreshed");
    expect(result.current.dropboxToken).toBe("dbx-refreshed");
  });

  it("boot effect completes a pending Dropbox redirect, stores tokens, and switches", async () => {
    setSearch("?code=AUTHCODE");
    hasPendingDropboxAuth.mockReturnValue(true);
    completeDropboxAuth.mockResolvedValue({
      accessToken: "dbx-new",
      refreshToken: "dbx-ref-new",
    });
    const selectBackend = vi.fn();
    const { result } = renderHook(() => useCloudBackend({ selectBackend }));
    await waitFor(() => expect(result.current.dropboxToken).toBe("dbx-new"));
    expect(completeDropboxAuth).toHaveBeenCalledWith("AUTHCODE");
    expect(setDropboxToken).toHaveBeenCalledWith("dbx-new");
    expect(setDropboxRefreshToken).toHaveBeenCalledWith("dbx-ref-new");
    expect(result.current.dropboxRefresh).toBe("dbx-ref-new");
    expect(selectBackend).toHaveBeenCalledWith("dropbox");
    expect(unlock).toHaveBeenCalledWith("cloudWalker");
    // The spent code is stripped from the address bar so a refresh can't replay it.
    expect(window.location.search).toBe("");
  });

  it("boot effect is a no-op when there is no redirect code", async () => {
    setSearch("");
    hasPendingDropboxAuth.mockReturnValue(true);
    const selectBackend = vi.fn();
    renderHook(() => useCloudBackend({ selectBackend }));
    await Promise.resolve();
    expect(completeDropboxAuth).not.toHaveBeenCalled();
    expect(selectBackend).not.toHaveBeenCalled();
  });

  it("boot effect ignores a code when no Dropbox auth is pending", async () => {
    setSearch("?code=STALE");
    hasPendingDropboxAuth.mockReturnValue(false);
    const selectBackend = vi.fn();
    renderHook(() => useCloudBackend({ selectBackend }));
    await Promise.resolve();
    expect(completeDropboxAuth).not.toHaveBeenCalled();
    expect(selectBackend).not.toHaveBeenCalled();
  });

  it("boot effect cleans the URL but does not switch when completion fails", async () => {
    setSearch("?code=BADCODE");
    hasPendingDropboxAuth.mockReturnValue(true);
    completeDropboxAuth.mockRejectedValue(new Error("token exchange failed"));
    const selectBackend = vi.fn();
    const { result } = renderHook(() => useCloudBackend({ selectBackend }));
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(selectBackend).not.toHaveBeenCalled();
    expect(result.current.dropboxToken).toBeNull();
  });
});
