// Pins the Google Drive file store's request sequence through the exported
// settings-store factory with a scripted fetch: which URLs are hit, in what
// order, with which methods/headers/bodies, and how HTTP failures map onto
// the adapter's typed errors. The OAuth flow itself has no automated
// coverage (it needs a real Google popup), so these tests are the contract
// for everything below the token.

import { describe, expect, it } from "vitest";

import { AuthError, RateLimitError } from "../../src/storage/adapter.ts";
import { createGdriveSettingsStore } from "../../src/storage/gdrive/index.ts";

const FILES_API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

const APP_FOLDER_QUERY =
  `name='notes' and mimeType='${FOLDER_MIME}'` +
  ` and 'root' in parents and trashed=false`;

function searchUrl(query: string, fields = "id"): string {
  return `${FILES_API}?q=${encodeURIComponent(query)}&spaces=drive&fields=files(${fields}),nextPageToken&pageSize=1000`;
}

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

describe("gdrive file store (via the settings store)", () => {
  it("load(): resolves the app folder, finds the file, downloads it", async () => {
    const { impl, calls } = scriptedFetch([
      { json: { files: [{ id: "app1" }] } },
      { json: { files: [{ id: "f1" }] } },
      { text: '{"theme":"dark"}' },
    ]);
    const store = createGdriveSettingsStore("tok", impl);

    await expect(store.load()).resolves.toBe('{"theme":"dark"}');

    expect(calls.map((c) => c.url)).toEqual([
      searchUrl(APP_FOLDER_QUERY),
      searchUrl(`name='settings.json' and 'app1' in parents and trashed=false`),
      `${FILES_API}/f1?alt=media`,
    ]);
    for (const call of calls) {
      expect(call.method).toBe("GET");
      expect(call.headers.Authorization).toBe("Bearer tok");
    }
  });

  it("load(): returns null after one request when the app folder is absent", async () => {
    const { impl, calls } = scriptedFetch([{ json: { files: [] } }]);
    const store = createGdriveSettingsStore("tok", impl);

    await expect(store.load()).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("load(): returns null when the file itself is absent", async () => {
    const { impl, calls } = scriptedFetch([
      { json: { files: [{ id: "app1" }] } },
      { json: { files: [] } },
    ]);
    const store = createGdriveSettingsStore("tok", impl);

    await expect(store.load()).resolves.toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("save(): creates the app folder and multipart-uploads a new file", async () => {
    const { impl, calls } = scriptedFetch([
      { json: { files: [] } },
      { json: { id: "app1" } },
      { json: { files: [] } },
      { json: { version: "1" } },
    ]);
    const store = createGdriveSettingsStore("tok", impl);

    await store.save('{"theme":"light"}');

    expect(calls).toHaveLength(4);
    const [rootSearch, folderCreate, fileSearch, upload] = calls as [
      Call,
      Call,
      Call,
      Call,
    ];
    expect(rootSearch.url).toBe(searchUrl(APP_FOLDER_QUERY));

    expect(folderCreate.url).toBe(`${FILES_API}?fields=id`);
    expect(folderCreate.method).toBe("POST");
    expect(folderCreate.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(folderCreate.body))).toEqual({
      name: "notes",
      mimeType: FOLDER_MIME,
    });

    expect(fileSearch.url).toBe(
      searchUrl(`name='settings.json' and 'app1' in parents and trashed=false`),
    );

    expect(upload.url).toBe(
      `${UPLOAD_API}?uploadType=multipart&fields=version`,
    );
    expect(upload.method).toBe("POST");
    expect(upload.headers["Content-Type"]).toMatch(
      /^multipart\/related; boundary=notes-/,
    );
    expect(String(upload.body)).toContain('"name":"settings.json"');
    expect(String(upload.body)).toContain('{"theme":"light"}');
  });

  it("save(): media-PATCHes the existing file", async () => {
    const { impl, calls } = scriptedFetch([
      { json: { files: [{ id: "app1" }] } },
      { json: { files: [{ id: "f1" }] } },
      { json: { version: "2" } },
    ]);
    const store = createGdriveSettingsStore("tok", impl);

    await store.save('{"theme":"dark"}');

    expect(calls).toHaveLength(3);
    const patch = calls[2] as Call;
    expect(patch.url).toBe(`${UPLOAD_API}/f1?uploadType=media&fields=version`);
    expect(patch.method).toBe("PATCH");
    expect(patch.headers["Content-Type"]).toBe("text/markdown");
    expect(patch.body).toBe('{"theme":"dark"}');
  });

  it("maps 401 to AuthError", async () => {
    const { impl } = scriptedFetch([{ status: 401, text: "unauthorized" }]);
    const store = createGdriveSettingsStore("tok", impl);

    await expect(store.load()).rejects.toBeInstanceOf(AuthError);
  });

  it("maps a 403 rate-limit body to RateLimitError honouring Retry-After", async () => {
    const { impl } = scriptedFetch([
      {
        status: 403,
        text: '{"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}',
        headers: { "Retry-After": "7" },
      },
    ]);
    const store = createGdriveSettingsStore("tok", impl);

    const err = await store.load().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBe(7000);
  });

  it("maps a bare 429 to RateLimitError with the fallback cooldown", async () => {
    const { impl } = scriptedFetch([{ status: 429, text: "slow down" }]);
    const store = createGdriveSettingsStore("tok", impl);

    const err = await store.load().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBe(5000);
  });

  it("surfaces other HTTP failures as plain errors naming the operation", async () => {
    const { impl } = scriptedFetch([{ status: 500, text: "boom" }]);
    const store = createGdriveSettingsStore("tok", impl);

    await expect(store.load()).rejects.toThrow(
      "Google Drive search failed: 500 boom",
    );
  });
});
