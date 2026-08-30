// @vitest-environment jsdom
//
// The desktop half of the OAuth flow (`runLoopbackAuth`). The Electron shell
// only holds the socket, so everything worth getting wrong is here: which URI
// the provider is told to redirect to, that the SAME URI is replayed at the
// token endpoint, that a redirect carrying someone else's `state` never gets
// its code spent, and that a failed attempt leaves no verifier behind for a
// later redirect to resume.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OAuthConfig } from "../../src/storage/oauth-pkce.ts";
import { runLoopbackAuth } from "../../src/storage/oauth-pkce.ts";

const REDIRECT = "http://127.0.0.1:53682/";

// The shell's side of the bridge. `beginLoopbackRedirect` hands back the URI
// the listener is bound to; `awaitLoopbackRedirect` resolves with whatever the
// provider sent back to it.
const beginLoopbackRedirect = vi.fn(async () => REDIRECT);
const awaitLoopbackRedirect = vi.fn(async () => new URLSearchParams());
vi.mock("../../src/platform/desktop-bridge.ts", () => ({
  beginLoopbackRedirect: () => beginLoopbackRedirect(),
  awaitLoopbackRedirect: () => awaitLoopbackRedirect(),
}));

const CONFIG: OAuthConfig = {
  authBase: "https://provider.test/oauth2/authorize",
  tokenEndpoint: "https://provider.test/oauth2/token",
  clientId: "test-client",
  state: "dropbox",
  verifierKey: "notes:test:pkce:verifier",
  providerName: "Dropbox",
  extraAuthParams: { token_access_type: "offline" },
};

/** The URL `window.open` was called with, parsed. */
function openedUrl(open: ReturnType<typeof vi.fn>): URL {
  expect(open).toHaveBeenCalledTimes(1);
  const [url] = open.mock.calls[0] as [string];
  return new URL(url);
}

function tokenResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

let open: ReturnType<typeof vi.fn>;

beforeEach(() => {
  open = vi.fn(() => null);
  vi.stubGlobal("open", open);
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("runLoopbackAuth", () => {
  it("sends the provider to the loopback URI and replays it at the token endpoint", async () => {
    awaitLoopbackRedirect.mockResolvedValueOnce(
      new URLSearchParams({ code: "auth-code", state: "dropbox" }),
    );
    const fetchImpl = vi.fn(async () =>
      tokenResponse({ access_token: "at", refresh_token: "rt" }),
    );

    const result = await runLoopbackAuth(
      CONFIG,
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toEqual({ accessToken: "at", refreshToken: "rt" });

    // The consent screen is opened, not navigated to — the shell turns this
    // into `shell.openExternal`.
    const url = openedUrl(open);
    expect(url.origin + url.pathname).toBe(CONFIG.authBase);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("client_id")).toBe("test-client");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("state")).toBe("dropbox");
    // Provider-specific extras still ride along.
    expect(url.searchParams.get("token_access_type")).toBe("offline");

    // The token exchange must carry the SAME redirect URI — the providers
    // check it again there, and `window.location` knows nothing about it.
    const [endpoint, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(endpoint).toBe(CONFIG.tokenEndpoint);
    const body = new URLSearchParams(init.body as string);
    expect(body.get("redirect_uri")).toBe(REDIRECT);
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBeTruthy();

    // The verifier is single-use and consumed by the exchange.
    expect(sessionStorage.getItem(CONFIG.verifierKey)).toBeNull();
  });

  it("never spends a code that came back with someone else's state", async () => {
    awaitLoopbackRedirect.mockResolvedValueOnce(
      new URLSearchParams({ code: "auth-code", state: "not-ours" }),
    );
    const fetchImpl = vi.fn();

    await expect(
      runLoopbackAuth(CONFIG, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/unexpected state/i);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(CONFIG.verifierKey)).toBeNull();
  });

  it("surfaces a declined consent with the provider's own description", async () => {
    awaitLoopbackRedirect.mockResolvedValueOnce(
      new URLSearchParams({
        error: "access_denied",
        error_description: "The user chose not to continue",
        state: "dropbox",
      }),
    );

    await expect(runLoopbackAuth(CONFIG)).rejects.toThrow(
      /The user chose not to continue/,
    );
    expect(sessionStorage.getItem(CONFIG.verifierKey)).toBeNull();
  });

  it("rejects when the listener timed out before any redirect arrived", async () => {
    awaitLoopbackRedirect.mockRejectedValueOnce(
      new Error("timed out waiting for the authorization redirect"),
    );

    await expect(runLoopbackAuth(CONFIG)).rejects.toThrow(/timed out/);
    // The half-finished attempt must not leave a verifier that would make
    // `hasPendingDropboxAuth` claim a redirect is still in flight.
    expect(sessionStorage.getItem(CONFIG.verifierKey)).toBeNull();
  });

  it("rejects a redirect that carries neither a code nor an error", async () => {
    awaitLoopbackRedirect.mockResolvedValueOnce(
      new URLSearchParams({ state: "dropbox" }),
    );

    await expect(runLoopbackAuth(CONFIG)).rejects.toThrow(/no code/i);
  });

  it("does not open a browser window when no listener could be opened", async () => {
    beginLoopbackRedirect.mockRejectedValueOnce(
      new Error("no loopback port available"),
    );

    await expect(runLoopbackAuth(CONFIG)).rejects.toThrow(/no loopback port/);
    expect(open).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(CONFIG.verifierKey)).toBeNull();
  });
});
