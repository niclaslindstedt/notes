// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { unlock } from "../../src/achievements/index.ts";
import { useCloudBackend } from "../../src/storage/useCloudBackend.ts";

// The connect verbs fire the "cloudWalker" achievement; spy on it rather than
// draining the real bus.
vi.mock("../../src/achievements/index.ts", () => ({ unlock: vi.fn() }));

// The token persistence reaches localStorage; the hook seeds its state from the
// getters and writes through the setters/clearers, so make each controllable.
let dropboxTokenMock: string | null = null;
let dropboxRefreshMock: string | null = null;
let gdriveTokenMock: string | null = null;
const setDropboxToken = vi.fn();
const setDropboxRefreshToken = vi.fn();
const setGdriveToken = vi.fn();
const clearDropboxToken = vi.fn();
const clearDropboxRefreshToken = vi.fn();
const clearGdriveToken = vi.fn();
vi.mock("../../src/storage/backend-preference.ts", async (importActual) => {
  const actual =
    await importActual<
      typeof import("../../src/storage/backend-preference.ts")
    >();
  return {
    ...actual,
    getDropboxToken: () => dropboxTokenMock,
    getDropboxRefreshToken: () => dropboxRefreshMock,
    getGdriveToken: () => gdriveTokenMock,
    setDropboxToken: (t: string) => setDropboxToken(t),
    setDropboxRefreshToken: (t: string) => setDropboxRefreshToken(t),
    setGdriveToken: (t: string) => setGdriveToken(t),
    clearDropboxToken: () => clearDropboxToken(),
    clearDropboxRefreshToken: () => clearDropboxRefreshToken(),
    clearGdriveToken: () => clearGdriveToken(),
  };
});

// The OAuth flows talk to the real cloud APIs; the hook only needs to start /
// complete / probe them, so stub each and assert.
const startDropboxAuth = vi.fn(async () => {});
const hasPendingDropboxAuth = vi.fn(() => false);
const completeDropboxAuth = vi.fn(
  async (_code: string) =>
    ({ accessToken: "db-access", refreshToken: "db-refresh" }) as {
      accessToken: string;
      refreshToken?: string;
    },
);
vi.mock("../../src/storage/dropbox/index.ts", () => ({
  startDropboxAuth: () => startDropboxAuth(),
  hasPendingDropboxAuth: () => hasPendingDropboxAuth(),
  completeDropboxAuth: (code: string) => completeDropboxAuth(code),
  isDropboxConfigured: () => true,
}));

const startGdriveAuth = vi.fn(async () => "gd-token");
vi.mock("../../src/storage/gdrive/index.ts", () => ({
  startGdriveAuth: () => startGdriveAuth(),
  isGdriveConfigured: () => true,
}));

function setUrl(search: string): void {
  window.history.replaceState(null, "", `/${search}`);
}

beforeEach(() => {
  dropboxTokenMock = null;
  dropboxRefreshMock = null;
  gdriveTokenMock = null;
  setUrl("");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useCloudBackend", () => {
  it("seeds connected flags from the stored tokens and exposes config flags", () => {
    dropboxTokenMock = "db";
    gdriveTokenMock = null;
    const selectBackend = vi.fn();
    const { result } = renderHook(() => useCloudBackend(selectBackend));

    expect(result.current.dropboxToken).toBe("db");
    expect(result.current.dropboxConnected).toBe(true);
    expect(result.current.gdriveConnected).toBe(false);
    expect(result.current.dropboxConfigured).toBe(true);
    expect(result.current.gdriveConfigured).toBe(true);
  });

  it("connectDropbox starts the redirect and does not switch backend itself", () => {
    const selectBackend = vi.fn();
    const { result } = renderHook(() => useCloudBackend(selectBackend));

    act(() => result.current.connectDropbox());

    expect(startDropboxAuth).toHaveBeenCalledTimes(1);
    // Completion (and the backend switch) lands in the boot effect, not here.
    expect(selectBackend).not.toHaveBeenCalled();
  });

  it("disconnectDropbox clears both tokens, drops state, and falls back to browser", () => {
    dropboxTokenMock = "db";
    dropboxRefreshMock = "rt";
    const selectBackend = vi.fn();
    const { result } = renderHook(() => useCloudBackend(selectBackend));

    act(() => result.current.disconnectDropbox());

    expect(clearDropboxToken).toHaveBeenCalledTimes(1);
    expect(clearDropboxRefreshToken).toHaveBeenCalledTimes(1);
    expect(selectBackend).toHaveBeenCalledWith("browser");
    expect(result.current.dropboxToken).toBeNull();
    expect(result.current.dropboxConnected).toBe(false);
  });

  it("connectGdrive runs the popup, stores the token, switches, and unlocks the achievement", async () => {
    const selectBackend = vi.fn();
    const { result } = renderHook(() => useCloudBackend(selectBackend));

    await act(async () => {
      await result.current.connectGdrive();
    });

    expect(startGdriveAuth).toHaveBeenCalledTimes(1);
    expect(setGdriveToken).toHaveBeenCalledWith("gd-token");
    expect(selectBackend).toHaveBeenCalledWith("gdrive");
    expect(unlock).toHaveBeenCalledWith("cloudWalker");
    expect(result.current.gdriveToken).toBe("gd-token");
    expect(result.current.gdriveConnected).toBe(true);
  });

  it("disconnectGdrive clears the token, drops state, and falls back to browser", () => {
    gdriveTokenMock = "gd";
    const selectBackend = vi.fn();
    const { result } = renderHook(() => useCloudBackend(selectBackend));

    act(() => result.current.disconnectGdrive());

    expect(clearGdriveToken).toHaveBeenCalledTimes(1);
    expect(selectBackend).toHaveBeenCalledWith("browser");
    expect(result.current.gdriveToken).toBeNull();
    expect(result.current.gdriveConnected).toBe(false);
  });

  it("applyDropboxAccessToken persists and applies a refreshed access token", () => {
    const selectBackend = vi.fn();
    const { result } = renderHook(() => useCloudBackend(selectBackend));

    act(() => result.current.applyDropboxAccessToken("fresh"));

    expect(setDropboxToken).toHaveBeenCalledWith("fresh");
    expect(result.current.dropboxToken).toBe("fresh");
    expect(result.current.dropboxConnected).toBe(true);
  });

  it("completes the Dropbox boot redirect when a pending ?code= is present", async () => {
    hasPendingDropboxAuth.mockReturnValue(true);
    setUrl("?code=abc&state=xyz");
    const selectBackend = vi.fn();
    const { result } = renderHook(() => useCloudBackend(selectBackend));

    await waitFor(() => expect(result.current.dropboxConnected).toBe(true));

    expect(completeDropboxAuth).toHaveBeenCalledWith("abc");
    expect(setDropboxToken).toHaveBeenCalledWith("db-access");
    expect(setDropboxRefreshToken).toHaveBeenCalledWith("db-refresh");
    expect(selectBackend).toHaveBeenCalledWith("dropbox");
    expect(unlock).toHaveBeenCalledWith("cloudWalker");
    expect(result.current.dropboxToken).toBe("db-access");
    // The spent authorization code is stripped from the address bar.
    expect(window.location.search).toBe("");
  });

  it("does not complete the redirect when there is no pending Dropbox auth", () => {
    hasPendingDropboxAuth.mockReturnValue(false);
    setUrl("?code=abc");
    const selectBackend = vi.fn();
    renderHook(() => useCloudBackend(selectBackend));

    expect(completeDropboxAuth).not.toHaveBeenCalled();
    expect(selectBackend).not.toHaveBeenCalled();
  });

  it("ignores a missing access-token refresh and leaves prior refresh untouched", async () => {
    hasPendingDropboxAuth.mockReturnValue(true);
    completeDropboxAuth.mockResolvedValueOnce({ accessToken: "only-access" });
    setUrl("?code=abc");
    const selectBackend = vi.fn();
    const { result } = renderHook(() => useCloudBackend(selectBackend));

    await waitFor(() => expect(result.current.dropboxConnected).toBe(true));

    expect(setDropboxToken).toHaveBeenCalledWith("only-access");
    expect(setDropboxRefreshToken).not.toHaveBeenCalled();
  });
});
