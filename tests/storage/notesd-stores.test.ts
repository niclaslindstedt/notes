import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthError } from "../../src/storage/adapter.ts";
import type { NotesdConfig } from "../../src/storage/backend-preference.ts";
import {
  createNotesdNamespaceStore,
  createNotesdSettingsStore,
  deleteNotesdNamespace,
} from "../../src/storage/notesd/index.ts";

const CONFIG: NotesdConfig = {
  endpoint: "https://daemon.test:8443",
  deviceKey: "device-key-123",
  spkiPin: "sha256:pin",
  name: "Test daemon",
};

// A fake daemon settings/notes surface over `fetch`: an in-memory map keyed by
// the `/v1/settings/<name>` and `/v1/notes/<ref>` paths, with the daemon's
// status codes (404 for a missing file, 204 for a write, 200 + body on read).
function fakeDaemon(opts: { unauthorized?: boolean } = {}) {
  const files = new Map<string, string>();
  const calls: {
    method: string;
    path: string;
    auth: string | null;
    body: string | null;
  }[] = [];

  const fetchImpl = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const method = init?.method ?? "GET";
    const path = new URL(String(url)).pathname;
    const headers = new Headers(init?.headers);
    calls.push({
      method,
      path,
      auth: headers.get("Authorization"),
      body: (init?.body as string) ?? null,
    });

    if (opts.unauthorized) return new Response("nope", { status: 401 });

    if (method === "GET") {
      const stored = files.get(path);
      if (stored === undefined) return new Response("", { status: 404 });
      return new Response(stored, { status: 200 });
    }
    if (method === "PUT") {
      files.set(path, (init?.body as string) ?? "");
      return new Response(null, { status: 204 });
    }
    if (method === "DELETE") {
      if (!files.has(path)) return new Response("", { status: 404 });
      files.delete(path);
      return new Response(null, { status: 204 });
    }
    return new Response("", { status: 405 });
  }) as typeof fetch;

  return { fetchImpl, calls, files };
}

afterEach(() => vi.restoreAllMocks());

describe("createNotesdSettingsStore", () => {
  it("returns null before settings.json exists", async () => {
    const { fetchImpl } = fakeDaemon();
    const store = createNotesdSettingsStore(CONFIG, fetchImpl);
    expect(await store.load()).toBeNull();
  });

  it("round-trips settings JSON with a bearer key", async () => {
    const daemon = fakeDaemon();
    const store = createNotesdSettingsStore(CONFIG, daemon.fetchImpl);

    await store.save('{"theme":"monokai"}');
    expect(await store.load()).toBe('{"theme":"monokai"}');

    const put = daemon.calls.find((c) => c.method === "PUT");
    expect(put?.path).toBe("/v1/settings/settings.json");
    expect(put?.auth).toBe("Bearer device-key-123");
  });

  it("maps a 401 to an AuthError", async () => {
    const { fetchImpl } = fakeDaemon({ unauthorized: true });
    const store = createNotesdSettingsStore(CONFIG, fetchImpl);
    await expect(store.load()).rejects.toBeInstanceOf(AuthError);
  });
});

describe("createNotesdNamespaceStore", () => {
  it("round-trips the namespace registry at namespaces.json", async () => {
    const daemon = fakeDaemon();
    const store = createNotesdNamespaceStore(CONFIG, daemon.fetchImpl);

    expect(await store.load()).toBeNull();
    await store.save('{"namespaces":[]}');
    expect(await store.load()).toBe('{"namespaces":[]}');

    const put = daemon.calls.find((c) => c.method === "PUT");
    expect(put?.path).toBe("/v1/settings/namespaces.json");
  });

  it("keeps settings and namespaces in separate files", async () => {
    const daemon = fakeDaemon();
    const settings = createNotesdSettingsStore(CONFIG, daemon.fetchImpl);
    const namespaces = createNotesdNamespaceStore(CONFIG, daemon.fetchImpl);

    await settings.save("S");
    await namespaces.save("N");
    expect(await settings.load()).toBe("S");
    expect(await namespaces.load()).toBe("N");
  });
});

describe("deleteNotesdNamespace", () => {
  it("deletes a non-default namespace's document ref", async () => {
    const daemon = fakeDaemon();
    // Seed the namespace document the way the adapter would have written it.
    daemon.files.set("/v1/notes/document-work.json", "doc");

    await deleteNotesdNamespace(CONFIG, daemon.fetchImpl, "work");
    expect(daemon.files.has("/v1/notes/document-work.json")).toBe(false);

    const del = daemon.calls.find((c) => c.method === "DELETE");
    expect(del?.path).toBe("/v1/notes/document-work.json");
    expect(del?.auth).toBe("Bearer device-key-123");
  });

  it("never deletes the default namespace's document.json", async () => {
    const daemon = fakeDaemon();
    await deleteNotesdNamespace(CONFIG, daemon.fetchImpl, "default");
    expect(daemon.calls).toHaveLength(0);
  });

  it("treats an already-gone namespace (404) as success", async () => {
    const daemon = fakeDaemon();
    await expect(
      deleteNotesdNamespace(CONFIG, daemon.fetchImpl, "gone"),
    ).resolves.toBeUndefined();
  });
});
