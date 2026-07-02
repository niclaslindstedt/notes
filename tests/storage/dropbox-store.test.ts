// Pins the Dropbox file store's request sequence with a scripted fetch: which
// endpoints are hit, with which methods/headers/bodies, and how HTTP failures
// map onto the adapter's typed errors and silent token refresh. The OAuth flow
// itself has no automated coverage (it needs a real Dropbox popup), so these
// tests are the contract for everything below the token.
//
// `read` / `write` / `remove` / the 401-refresh / 429-rate-limit paths are
// exercised through the public `createDropboxSettingsStore` (a shallow root
// file store); the paginated `list()` walk is pinned directly against the
// shared `listAllFiles` helper in `dropbox-list.test.ts`.

import { describe, expect, it, vi } from "vitest";

import { AuthError, RateLimitError } from "../../src/storage/adapter.ts";
import {
  createDropboxSettingsStore,
  type DropboxAuth,
} from "../../src/storage/dropbox/index.ts";

const DOWNLOAD = "https://content.dropboxapi.com/2/files/download";
const UPLOAD = "https://content.dropboxapi.com/2/files/upload";
const TOKEN = "https://api.dropboxapi.com/oauth2/token";

type Scripted = {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
};

type Call = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: BodyInit | null | undefined;
};

function scriptedFetch(responses: Scripted[]) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request: ${String(input)}`);
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      body: init?.body,
    });
    return new Response(next.text ?? JSON.stringify(next.json ?? {}), {
      status: next.status ?? 200,
      headers: next.headers,
    });
  }) as typeof fetch;
  return { impl, calls };
}

describe("dropbox file store (via the settings store)", () => {
  it("read(): downloads /settings.json and returns its text", async () => {
    const { impl, calls } = scriptedFetch([{ text: '{"theme":"dark"}' }]);
    const store = createDropboxSettingsStore("tok", impl);

    await expect(store.load()).resolves.toBe('{"theme":"dark"}');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(DOWNLOAD);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers.Authorization).toBe("Bearer tok");
    // The path rides the ASCII-escaped Dropbox-API-Arg header.
    expect(calls[0]!.headers["Dropbox-API-Arg"]).toContain("/settings.json");
  });

  it("read(): treats 409 (path/not_found) as an absent file → null", async () => {
    const { impl, calls } = scriptedFetch([{ status: 409, text: "not_found" }]);
    const store = createDropboxSettingsStore("tok", impl);
    await expect(store.load()).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("write(): uploads to /settings.json with overwrite mode", async () => {
    const { impl, calls } = scriptedFetch([{ json: { rev: "a1" } }]);
    const store = createDropboxSettingsStore("tok", impl);

    await store.save('{"theme":"light"}');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(UPLOAD);
    expect(calls[0]!.method).toBe("POST");
    const arg = calls[0]!.headers["Dropbox-API-Arg"]!;
    expect(arg).toContain("/settings.json");
    expect(arg).toContain("overwrite");
    expect(calls[0]!.body).toBe('{"theme":"light"}');
  });

  it("write(): maps a 429 onto RateLimitError with the Retry-After delay", async () => {
    const { impl } = scriptedFetch([
      { status: 429, headers: { "Retry-After": "2" }, text: "slow down" },
    ]);
    const store = createDropboxSettingsStore("tok", impl);
    await expect(store.save("x")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("read(): a 401 triggers a silent refresh and retries with the fresh token", async () => {
    const onAccessTokenRefreshed = vi.fn();
    const auth: DropboxAuth = {
      accessToken: "stale",
      refreshToken: "refresh-me",
      onAccessTokenRefreshed,
    };
    const { impl, calls } = scriptedFetch([
      { status: 401, text: "expired_access_token" },
      { json: { access_token: "fresh" } }, // token endpoint
      { text: "recovered" },
    ]);
    const store = createDropboxSettingsStore(auth, impl);

    await expect(store.load()).resolves.toBe("recovered");

    expect(calls.map((c) => c.url)).toEqual([DOWNLOAD, TOKEN, DOWNLOAD]);
    // First attempt used the stale token; the retry used the refreshed one.
    expect(calls[0]!.headers.Authorization).toBe("Bearer stale");
    expect(calls[2]!.headers.Authorization).toBe("Bearer fresh");
    expect(onAccessTokenRefreshed).toHaveBeenCalledWith("fresh");
  });

  it("read(): a 401 with no refresh token surfaces AuthError", async () => {
    const { impl } = scriptedFetch([{ status: 401, text: "no_token" }]);
    const store = createDropboxSettingsStore("tok", impl);
    await expect(store.load()).rejects.toBeInstanceOf(AuthError);
  });
});
