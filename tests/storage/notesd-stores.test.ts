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
    const parsed = new URL(String(url));
    const path = parsed.pathname;
    const headers = new Headers(init?.headers);
    calls.push({
      method,
      path,
      auth: headers.get("Authorization"),
      body: (init?.body as string) ?? null,
    });

    if (opts.unauthorized) return new Response("nope", { status: 401 });

    // Blob listing: return every stored `/v1/blob/<key>` whose key starts with
    // the requested prefix (used by `deleteNotesdNamespace`).
    if (method === "GET" && path === "/v1/blobs") {
      const prefix = parsed.searchParams.get("prefix") ?? "";
      const blobs = [...files.keys()]
        .filter((p) => p.startsWith("/v1/blob/"))
        .map((p) => p.slice("/v1/blob/".length))
        .filter((p) => p.startsWith(prefix))
        .map((p) => ({ path: p }));
      return new Response(JSON.stringify({ blobs }), { status: 200 });
    }

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
  it("deletes every blob under the namespace's subfolder", async () => {
    const daemon = fakeDaemon();
    // Seed the namespace's notes + attachments the way the adapter would.
    daemon.files.set("/v1/blob/work/notes/a-1.md", "note");
    daemon.files.set("/v1/blob/work/attachments/a-1/pic.png", "img");
    // A different namespace's file must be left untouched.
    daemon.files.set("/v1/blob/notes/keep-me.md", "keep");

    await deleteNotesdNamespace(CONFIG, daemon.fetchImpl, "work");

    expect(daemon.files.has("/v1/blob/work/notes/a-1.md")).toBe(false);
    expect(daemon.files.has("/v1/blob/work/attachments/a-1/pic.png")).toBe(
      false,
    );
    expect(daemon.files.has("/v1/blob/notes/keep-me.md")).toBe(true);

    const deletes = daemon.calls
      .filter((c) => c.method === "DELETE")
      .map((c) => c.path)
      .sort();
    expect(deletes).toEqual([
      "/v1/blob/work/attachments/a-1/pic.png",
      "/v1/blob/work/notes/a-1.md",
    ]);
    expect(daemon.calls.every((c) => c.auth === "Bearer device-key-123")).toBe(
      true,
    );
  });

  it("never touches the default namespace (shares the folder root)", async () => {
    const daemon = fakeDaemon();
    await deleteNotesdNamespace(CONFIG, daemon.fetchImpl, "default");
    expect(daemon.calls).toHaveLength(0);
  });

  it("treats an already-empty namespace as success", async () => {
    const daemon = fakeDaemon();
    await expect(
      deleteNotesdNamespace(CONFIG, daemon.fetchImpl, "gone"),
    ).resolves.toBeUndefined();
    // Listed the subtree, found nothing to delete.
    expect(daemon.calls.every((c) => c.method === "GET")).toBe(true);
  });
});
