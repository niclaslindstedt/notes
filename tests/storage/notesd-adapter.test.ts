import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthError, ConflictError } from "../../src/storage/adapter.ts";
import type { NotesdConfig } from "../../src/storage/backend-preference.ts";
import { createNotesdAdapter } from "../../src/storage/notesd/index.ts";

const CONFIG: NotesdConfig = {
  endpoint: "https://daemon.test:8443",
  deviceKey: "device-key-123",
  spkiPin: "sha256:pin",
  name: "Test daemon",
};

// A fake daemon over `fetch`: one in-memory document keyed by its ref, with the
// same If-Match / 409 semantics the real notesd serves. `etag` is a cheap
// content hash so a changed body changes the revision.
function fakeDaemon(opts: { unauthorized?: boolean } = {}) {
  let body: string | null = null;
  // Aggregate revision counter served by `GET /v1/rev`, bumped on every write —
  // the O(1) probe the adapter's `watch` shim polls.
  let rev = 0;
  const etagOf = (text: string) =>
    `e${[...text].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)}`;
  const calls: { method: string; url: string; ifMatch: string | null }[] = [];

  const fetchImpl = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const method = init?.method ?? "GET";
    const path = String(url);
    const headers = new Headers(init?.headers);
    calls.push({ method, url: path, ifMatch: headers.get("If-Match") });

    if (opts.unauthorized) return new Response("nope", { status: 401 });

    if (method === "GET" && path.endsWith("/v1/rev")) {
      return new Response(JSON.stringify({ rev }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (method === "GET") {
      if (body === null) return new Response("", { status: 404 });
      return new Response(body, {
        status: 200,
        headers: { ETag: etagOf(body) },
      });
    }
    if (method === "PUT") {
      const next = (init?.body as string) ?? "";
      const ifMatch = headers.get("If-Match");
      if (ifMatch !== null && (body === null || ifMatch !== etagOf(body))) {
        return new Response(body ?? "", {
          status: 409,
          headers: body !== null ? { ETag: etagOf(body) } : {},
        });
      }
      body = next;
      rev += 1;
      return new Response(JSON.stringify({ etag: etagOf(next) }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("", { status: 405 });
  }) as typeof fetch;

  // Move the document from "another device", bumping the aggregate revision the
  // way a real write would — without going through the adapter under test.
  const externalWrite = (text: string) => {
    body = text;
    rev += 1;
  };

  return { fetchImpl, calls, etagOf, current: () => body, externalWrite };
}

describe("createNotesdAdapter", () => {
  it("advertises its id and label", () => {
    const { fetchImpl } = fakeDaemon();
    const a = createNotesdAdapter(CONFIG, fetchImpl);
    expect(a.id).toBe("notesd");
    expect(a.label).toBe("Test daemon");
  });

  it("returns null when the document does not exist yet", async () => {
    const { fetchImpl } = fakeDaemon();
    const a = createNotesdAdapter(CONFIG, fetchImpl);
    expect(await a.load()).toBeNull();
  });

  it("round-trips a save then load, carrying the revision", async () => {
    const daemon = fakeDaemon();
    const a = createNotesdAdapter(CONFIG, daemon.fetchImpl);

    const saved = await a.save("hello");
    expect(saved.text).toBe("hello");
    expect(saved.revision).toBe(daemon.etagOf("hello"));

    const loaded = await a.load();
    expect(loaded).toEqual({ text: "hello", revision: daemon.etagOf("hello") });
  });

  it("sends If-Match on a based save and throws ConflictError when the remote moved", async () => {
    const daemon = fakeDaemon();
    const a = createNotesdAdapter(CONFIG, daemon.fetchImpl);

    const first = await a.save("v1");
    // A different device moves the document out from under us.
    await a.save("v2");

    await expect(a.save("v3", first.revision)).rejects.toBeInstanceOf(
      ConflictError,
    );
    try {
      await a.save("v3", first.revision);
    } catch (err) {
      expect((err as ConflictError).remote.text).toBe("v2");
      expect((err as ConflictError).remote.revision).toBe(daemon.etagOf("v2"));
    }
    // The based saves carried the If-Match header.
    expect(
      daemon.calls.some((c) => c.method === "PUT" && c.ifMatch !== null),
    ).toBe(true);
  });

  it("maps a 401 to AuthError", async () => {
    const { fetchImpl } = fakeDaemon({ unauthorized: true });
    const a = createNotesdAdapter(CONFIG, fetchImpl);
    await expect(a.load()).rejects.toBeInstanceOf(AuthError);
  });

  describe("watch", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("advertises the capability and exposes a watch method", () => {
      const { fetchImpl } = fakeDaemon();
      const a = createNotesdAdapter(CONFIG, fetchImpl);
      expect(a.capabilities.has("watch")).toBe(true);
      expect(typeof a.watch).toBe("function");
    });

    it("delivers a fresh snapshot when the aggregate revision moves", async () => {
      vi.useFakeTimers();
      const daemon = fakeDaemon();
      const a = createNotesdAdapter(CONFIG, daemon.fetchImpl);
      await a.save("v1");

      const seen: string[] = [];
      const unsubscribe = a.watch!((snap) => seen.push(snap.text));

      // The opening probe only seeds the baseline — no delivery yet.
      await vi.advanceTimersByTimeAsync(0);
      expect(seen).toEqual([]);

      // Another device moves the document; the next probe sees the bumped
      // revision, re-loads, and delivers the fresh bytes.
      daemon.externalWrite("v2");
      await vi.advanceTimersByTimeAsync(4000);
      expect(seen).toEqual(["v2"]);

      // A tick with no change delivers nothing.
      await vi.advanceTimersByTimeAsync(4000);
      expect(seen).toEqual(["v2"]);

      unsubscribe();
    });

    it("stops probing after unsubscribe", async () => {
      vi.useFakeTimers();
      const daemon = fakeDaemon();
      const a = createNotesdAdapter(CONFIG, daemon.fetchImpl);
      await a.save("v1");

      const seen: string[] = [];
      const unsubscribe = a.watch!((snap) => seen.push(snap.text));
      await vi.advanceTimersByTimeAsync(0);
      unsubscribe();

      const revCallsBefore = daemon.calls.filter((c) =>
        c.url.endsWith("/v1/rev"),
      ).length;
      daemon.externalWrite("v2");
      await vi.advanceTimersByTimeAsync(20000);

      const revCallsAfter = daemon.calls.filter((c) =>
        c.url.endsWith("/v1/rev"),
      ).length;
      expect(revCallsAfter).toBe(revCallsBefore);
      expect(seen).toEqual([]);
    });
  });
});
