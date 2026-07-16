import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthError } from "../../src/storage/adapter.ts";
import { attachmentMarkdown } from "../../src/domain/attachment.ts";
import { createNote, type Note } from "../../src/domain/note.ts";
import type { NotesdConfig } from "../../src/storage/backend-preference.ts";
import { createNotesdAdapter } from "../../src/storage/notesd/index.ts";
import { parse, serialize } from "../../src/storage/serialize.ts";

const CONFIG: NotesdConfig = {
  endpoint: "https://daemon.test:8443",
  deviceKey: "device-key-123",
  spkiPin: "sha256:pin",
  name: "Test daemon",
};

const enc = new TextEncoder();
// Normalise a request body (a note's UTF-8 string or an attachment's bytes) into
// a fresh `ArrayBuffer`-backed `Uint8Array` the `Response` constructor accepts.
const asBytes = (body: unknown): Uint8Array<ArrayBuffer> =>
  typeof body === "string"
    ? enc.encode(body)
    : new Uint8Array(body as Uint8Array);

// A fake notesd over `fetch` implementing the generic blob protocol the daemon
// now serves: an in-memory `path -> bytes` map, `GET /v1/blobs?prefix=&etag=`,
// `GET/PUT/DELETE /v1/blob/{*path}`, and the O(1) `GET /v1/rev` counter.
function fakeDaemon(opts: { unauthorized?: boolean } = {}) {
  const blobs = new Map<string, Uint8Array<ArrayBuffer>>();
  let rev = 0;
  const etagOf = (bytes: Uint8Array): string =>
    `e${bytes.reduce((a, b) => (a * 31 + b) | 0, 7)}`;
  const calls: { method: string; path: string; ifMatch: string | null }[] = [];

  const fetchImpl = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const method = init?.method ?? "GET";
    const parsed = new URL(String(url));
    const path = parsed.pathname;
    const headers = new Headers(init?.headers);
    calls.push({ method, path, ifMatch: headers.get("If-Match") });

    if (opts.unauthorized) return new Response("nope", { status: 401 });

    if (method === "GET" && path === "/v1/rev") {
      return new Response(JSON.stringify({ rev }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (method === "GET" && path === "/v1/blobs") {
      const prefix = parsed.searchParams.get("prefix") ?? "";
      const withEtag = parsed.searchParams.get("etag") !== "0";
      const out = [...blobs.entries()]
        .filter(([p]) => p.startsWith(prefix))
        .map(([p, bytes]) =>
          withEtag ? { path: p, etag: etagOf(bytes) } : { path: p },
        );
      return new Response(JSON.stringify({ blobs: out }), { status: 200 });
    }

    // `/v1/blob/<path>` — decode each segment back to the stored key.
    if (path.startsWith("/v1/blob/")) {
      const key = path
        .slice("/v1/blob/".length)
        .split("/")
        .map(decodeURIComponent)
        .join("/");
      if (method === "GET") {
        const bytes = blobs.get(key);
        if (!bytes) return new Response("", { status: 404 });
        return new Response(bytes, {
          status: 200,
          headers: { ETag: etagOf(bytes) },
        });
      }
      if (method === "PUT") {
        const bytes = asBytes(init?.body ?? "");
        blobs.set(key, bytes);
        rev += 1;
        return new Response(JSON.stringify({ etag: etagOf(bytes) }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (method === "DELETE") {
        const existed = blobs.delete(key);
        if (existed) rev += 1;
        return new Response(JSON.stringify({ deleted: existed }), {
          status: 200,
        });
      }
    }
    return new Response("", { status: 405 });
  }) as typeof fetch;

  return {
    fetchImpl,
    calls,
    paths: () => [...blobs.keys()].sort(),
    text: (key: string) => new TextDecoder().decode(blobs.get(key)),
    bumpRev: () => {
      rev += 1;
    },
  };
}

function plainNote(overrides: Partial<Note> = {}): Note {
  return { ...createNote(1), title: "Hello", body: "world", ...overrides };
}

describe("createNotesdAdapter (directory-backed)", () => {
  it("advertises id, label, and the attachments + watch capabilities", () => {
    const { fetchImpl } = fakeDaemon();
    const a = createNotesdAdapter(CONFIG, fetchImpl);
    expect(a.id).toBe("notesd");
    expect(a.label).toBe("Test daemon");
    expect(a.capabilities.has("attachments")).toBe(true);
    expect(a.capabilities.has("watch")).toBe(true);
    expect(typeof a.watch).toBe("function");
  });

  it("returns null when the folder is empty", async () => {
    const { fetchImpl } = fakeDaemon();
    const a = createNotesdAdapter(CONFIG, fetchImpl);
    expect(await a.load()).toBeNull();
  });

  it("writes each note as its own file under the namespace notes folder", async () => {
    const daemon = fakeDaemon();
    const a = createNotesdAdapter(CONFIG, daemon.fetchImpl);

    const note = plainNote({ title: "Groceries", body: "milk" });
    await a.save(serialize({ notes: [note] }));

    const notePaths = daemon.paths().filter((p) => p.endsWith(".md"));
    expect(notePaths).toHaveLength(1);
    expect(notePaths[0]!.startsWith("notes/")).toBe(true);
    expect(daemon.text(notePaths[0]!)).toContain("milk");

    // A fresh adapter (another device) reconstructs the document from the files.
    const b = createNotesdAdapter(CONFIG, daemon.fetchImpl);
    const loaded = await b.load();
    const notes = parse(loaded!.text).notes;
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toBe("Groceries");
    expect(notes[0]!.body).toBe("milk");
  });

  it("externalises a pasted image as a real attachment file, not inline", async () => {
    const daemon = fakeDaemon();
    const a = createNotesdAdapter(CONFIG, daemon.fetchImpl);

    const attachment = {
      filename: "abcd1234-pic.png",
      mime: "image/png",
      data: "data:image/png;base64,SGVsbG8=", // "Hello"
    };
    const note = plainNote({
      title: "Trip",
      body: `see ${attachmentMarkdown(attachment)}`,
      attachments: [attachment],
    });
    await a.save(serialize({ notes: [note] }));

    // The image is a file under `attachments/`, and its bytes are NOT baked into
    // the note markdown.
    const attPaths = daemon.paths().filter((p) => p.startsWith("attachments/"));
    expect(attPaths).toHaveLength(1);
    const notePath = daemon.paths().find((p) => p.endsWith(".md"))!;
    expect(daemon.text(notePath)).not.toContain("SGVsbG8=");

    // A fresh device loads the note with attachment metadata but no bytes, then
    // fetches the bytes on demand.
    const b = createNotesdAdapter(CONFIG, daemon.fetchImpl);
    const loaded = await b.load();
    const [reloaded] = parse(loaded!.text).notes;
    expect(reloaded!.attachments?.[0]!.filename).toBe("abcd1234-pic.png");
    const got = await b.fetchAttachment!(reloaded!, "abcd1234-pic.png");
    expect(got).not.toBeNull();
    expect(new TextDecoder().decode(got!.bytes)).toBe("Hello");
    expect(got!.mime).toBe("image/png");
  });

  it("scopes a non-default namespace to its own subfolder", async () => {
    const daemon = fakeDaemon();
    const a = createNotesdAdapter(CONFIG, daemon.fetchImpl, "work");
    await a.save(serialize({ notes: [plainNote({ title: "Report" })] }));

    const notePath = daemon.paths().find((p) => p.endsWith(".md"))!;
    expect(notePath.startsWith("work/notes/")).toBe(true);
  });

  it("maps a 401 to AuthError", async () => {
    const { fetchImpl } = fakeDaemon({ unauthorized: true });
    const a = createNotesdAdapter(CONFIG, fetchImpl);
    await expect(a.load()).rejects.toBeInstanceOf(AuthError);
  });

  describe("watch", () => {
    afterEach(() => vi.useRealTimers());

    it("delivers a fresh snapshot when the aggregate revision moves", async () => {
      vi.useFakeTimers();
      const daemon = fakeDaemon();
      const a = createNotesdAdapter(CONFIG, daemon.fetchImpl);
      await a.save(serialize({ notes: [plainNote({ title: "One" })] }));

      const seen: number[] = [];
      const unsubscribe = a.watch!((snap) =>
        seen.push(parse(snap.text).notes.length),
      );

      // The opening probe only seeds the baseline — no delivery yet.
      await vi.advanceTimersByTimeAsync(0);
      expect(seen).toEqual([]);

      // Another device writes a second note straight into the folder.
      const other = createNotesdAdapter(CONFIG, daemon.fetchImpl);
      const first = parse((await other.load())!.text).notes;
      await other.save(
        serialize({ notes: [...first, plainNote({ title: "Two" })] }),
      );

      await vi.advanceTimersByTimeAsync(4000);
      expect(seen).toEqual([2]);

      unsubscribe();
    });

    it("stops probing after unsubscribe", async () => {
      vi.useFakeTimers();
      const daemon = fakeDaemon();
      const a = createNotesdAdapter(CONFIG, daemon.fetchImpl);

      const seen: unknown[] = [];
      const unsubscribe = a.watch!((snap) => seen.push(snap));
      await vi.advanceTimersByTimeAsync(0);
      unsubscribe();

      const revBefore = daemon.calls.filter((c) => c.path === "/v1/rev").length;
      daemon.bumpRev();
      await vi.advanceTimersByTimeAsync(20000);
      const revAfter = daemon.calls.filter((c) => c.path === "/v1/rev").length;
      expect(revAfter).toBe(revBefore);
      expect(seen).toEqual([]);
    });
  });
});
