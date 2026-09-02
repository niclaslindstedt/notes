// The Nextcloud backend against a fake WebDAV server: what lands on disk, what
// a second device reads back, how a missing parent collection is created, and
// how the statuses that matter (401, 404, 507) reach the app as typed errors.
//
// The fake implements the same subset of the protocol the adapter uses —
// PROPFIND `Depth: 1`, GET, PUT, DELETE, MKCOL — with real collection
// semantics, so the MKCOL walk and the recursive listing are exercised rather
// than mocked away.

import { describe, expect, it } from "vitest";

import { attachmentMarkdown } from "../../src/domain/attachment.ts";
import { createNote, type Note } from "../../src/domain/note.ts";
import { AuthError } from "../../src/storage/adapter.ts";
import type { NextcloudConfig } from "../../src/storage/backend-preference.ts";
import {
  createNextcloudAdapter,
  createNextcloudSettingsStore,
  deleteNextcloudNamespace,
  verifyNextcloudConnection,
} from "../../src/storage/nextcloud/index.ts";
import { parse, serialize } from "../../src/storage/serialize.ts";

const CONFIG: NextcloudConfig = {
  endpoint: "https://cloud.test",
  username: "alice",
  appPassword: "app-password-123",
  folder: "notes",
};

const DAV_ROOT = "/remote.php/dav/files/alice";
const enc = new TextEncoder();

// Copy into a fresh `ArrayBuffer`-backed view — what `Response` accepts, and
// what the store hands back on a read.
const asBytes = (body: unknown): Uint8Array<ArrayBuffer> => {
  const raw =
    typeof body === "string" ? enc.encode(body) : (body as Uint8Array);
  const copy = new Uint8Array(new ArrayBuffer(raw.byteLength));
  copy.set(raw);
  return copy;
};

function parentOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

function href(key: string, collection: boolean): string {
  const encoded = key
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  const path = encoded ? `${DAV_ROOT}/${encoded}` : DAV_ROOT;
  return collection ? `${path}/` : path;
}

// An in-memory Nextcloud: `files` keyed by account-relative path, `dirs` the
// collections that exist. Nothing is auto-created — a PUT into a missing
// collection answers 409, exactly as SabreDAV does, which is what makes the
// adapter's create-parents-and-retry path real here.
function fakeNextcloud(opts: { status?: number } = {}) {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const dirs = new Set<string>([""]);
  const calls: { method: string; key: string }[] = [];
  const etagOf = (bytes: Uint8Array): string =>
    `"e${bytes.reduce((a, b) => (a * 31 + b) | 0, 7)}"`;

  const propResponse = (key: string): string => {
    const isDir = dirs.has(key);
    const props = isDir
      ? "<d:resourcetype><d:collection/></d:resourcetype>"
      : `<d:getetag>${etagOf(files.get(key)!)}</d:getetag><d:resourcetype/>`;
    return (
      `<d:response><d:href>${href(key, isDir)}</d:href><d:propstat><d:prop>` +
      `${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
    );
  };

  const fetchImpl = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const method = init?.method ?? "GET";
    const pathname = decodeURIComponent(new URL(String(url)).pathname);
    if (!pathname.startsWith(DAV_ROOT))
      return new Response("", { status: 404 });
    const key = pathname.slice(DAV_ROOT.length).replace(/^\/|\/$/g, "");
    calls.push({ method, key });

    if (opts.status) return new Response("nope", { status: opts.status });

    if (method === "PROPFIND") {
      if (!dirs.has(key) && !files.has(key)) {
        return new Response("", { status: 404 });
      }
      const children =
        dirs.has(key) &&
        init?.headers &&
        new Headers(init.headers).get("Depth") === "1"
          ? [...dirs, ...files.keys()].filter(
              (k) => k !== key && parentOf(k) === key,
            )
          : [];
      const body =
        '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">' +
        [key, ...children].map(propResponse).join("") +
        "</d:multistatus>";
      return new Response(body, { status: 207 });
    }
    if (method === "GET") {
      const bytes = files.get(key);
      if (!bytes) return new Response("", { status: 404 });
      return new Response(bytes, {
        status: 200,
        headers: { ETag: etagOf(bytes) },
      });
    }
    if (method === "PUT") {
      if (!dirs.has(parentOf(key))) return new Response("", { status: 409 });
      const bytes = asBytes(init?.body ?? "");
      files.set(key, bytes);
      return new Response("", {
        status: 201,
        headers: { ETag: etagOf(bytes) },
      });
    }
    if (method === "MKCOL") {
      if (dirs.has(key) || files.has(key))
        return new Response("", { status: 405 });
      if (!dirs.has(parentOf(key))) return new Response("", { status: 409 });
      dirs.add(key);
      return new Response("", { status: 201 });
    }
    if (method === "DELETE") {
      if (files.delete(key)) return new Response(null, { status: 204 });
      if (dirs.has(key)) {
        dirs.delete(key);
        for (const k of [...dirs, ...files.keys()]) {
          if (k.startsWith(`${key}/`)) {
            dirs.delete(k);
            files.delete(k);
          }
        }
        return new Response(null, { status: 204 });
      }
      return new Response("", { status: 404 });
    }
    return new Response("", { status: 405 });
  }) as typeof fetch;

  return {
    fetchImpl,
    calls,
    files,
    dirs,
    paths: () => [...files.keys()].sort(),
    text: (key: string) => new TextDecoder().decode(files.get(key)),
  };
}

function plainNote(overrides: Partial<Note> = {}): Note {
  return { ...createNote(1), title: "Hello", body: "world", ...overrides };
}

describe("createNextcloudAdapter", () => {
  it("advertises its id, label, and the attachments capability", () => {
    const server = fakeNextcloud();
    const a = createNextcloudAdapter(CONFIG, server.fetchImpl);
    expect(a.id).toBe("nextcloud");
    expect(a.label).toBe("Nextcloud");
    expect(a.capabilities.has("attachments")).toBe(true);
  });

  it("returns null when nothing has been written for the namespace yet", async () => {
    const server = fakeNextcloud();
    const a = createNextcloudAdapter(CONFIG, server.fetchImpl);
    expect(await a.load()).toBeNull();
  });

  it("creates the missing folders on the first save and writes one file per note", async () => {
    const server = fakeNextcloud();
    const a = createNextcloudAdapter(CONFIG, server.fetchImpl);

    await a.save(
      serialize({ notes: [plainNote({ title: "Groceries", body: "milk" })] }),
    );

    const notePaths = server.paths().filter((p) => p.endsWith(".md"));
    expect(notePaths).toHaveLength(1);
    expect(notePaths[0]!.startsWith("notes/notes/")).toBe(true);
    expect(server.text(notePaths[0]!)).toContain("milk");
    // The app folder and the namespace's notes folder were MKCOL'd on the way.
    expect(server.dirs.has("notes")).toBe(true);
    expect(server.dirs.has("notes/notes")).toBe(true);

    // A second device reconstructs the document from the files alone.
    const b = createNextcloudAdapter(CONFIG, server.fetchImpl);
    const loaded = await b.load();
    const notes = parse(loaded!.text).notes;
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toBe("Groceries");
    expect(notes[0]!.body).toBe("milk");
  });

  it("creates each parent collection once, not per file", async () => {
    const server = fakeNextcloud();
    const a = createNextcloudAdapter(CONFIG, server.fetchImpl);
    await a.save(
      serialize({
        notes: [
          plainNote({ title: "One" }),
          plainNote({ ...createNote(2), title: "Two" }),
        ],
      }),
    );
    const mkcols = server.calls.filter((c) => c.method === "MKCOL");
    expect(mkcols.map((c) => c.key)).toEqual(["notes", "notes/notes"]);
  });

  it("externalises a pasted image as a real attachment file", async () => {
    const server = fakeNextcloud();
    const a = createNextcloudAdapter(CONFIG, server.fetchImpl);

    const attachment = {
      filename: "abcd1234-pic.png",
      mime: "image/png",
      data: "data:image/png;base64,SGVsbG8=", // "Hello"
    };
    await a.save(
      serialize({
        notes: [
          plainNote({
            title: "Trip",
            body: `see ${attachmentMarkdown(attachment)}`,
            attachments: [attachment],
          }),
        ],
      }),
    );

    const attPaths = server
      .paths()
      .filter((p) => p.startsWith("notes/attachments/"));
    expect(attPaths).toHaveLength(1);
    const notePath = server.paths().find((p) => p.endsWith(".md"))!;
    expect(server.text(notePath)).not.toContain("SGVsbG8=");

    const b = createNextcloudAdapter(CONFIG, server.fetchImpl);
    const [reloaded] = parse((await b.load())!.text).notes;
    const got = await b.fetchAttachment!(reloaded!, "abcd1234-pic.png");
    expect(new TextDecoder().decode(got!.bytes)).toBe("Hello");
    expect(got!.mime).toBe("image/png");
  });

  it("scopes a non-default namespace to its own subfolder", async () => {
    const server = fakeNextcloud();
    const a = createNextcloudAdapter(CONFIG, server.fetchImpl, "work");
    await a.save(serialize({ notes: [plainNote({ title: "Report" })] }));
    expect(
      server
        .paths()
        .find((p) => p.endsWith(".md"))!
        .startsWith("notes/work/notes/"),
    ).toBe(true);
  });

  it("honours a custom app folder", async () => {
    const server = fakeNextcloud();
    const a = createNextcloudAdapter(
      { ...CONFIG, folder: "Apps/notes" },
      server.fetchImpl,
    );
    await a.save(serialize({ notes: [plainNote()] }));
    expect(server.paths()[0]!.startsWith("Apps/notes/notes/")).toBe(true);
  });

  it("maps a 401 to AuthError", async () => {
    const server = fakeNextcloud({ status: 401 });
    const a = createNextcloudAdapter(CONFIG, server.fetchImpl);
    await expect(a.load()).rejects.toBeInstanceOf(AuthError);
  });

  it("names an out-of-quota write rather than surfacing a bare status", async () => {
    const server = fakeNextcloud({ status: 507 });
    const a = createNextcloudAdapter(CONFIG, server.fetchImpl);
    await expect(a.save(serialize({ notes: [plainNote()] }))).rejects.toThrow(
      /out of storage space/,
    );
  });
});

describe("the root stores", () => {
  it("keeps settings.json at the app-folder root, beside the namespaces", async () => {
    const server = fakeNextcloud();
    server.dirs.add("notes");
    const store = createNextcloudSettingsStore(CONFIG, server.fetchImpl);
    expect(await store.load()).toBeNull();
    await store.save('{"theme":"oneDark"}');
    expect(server.paths()).toEqual(["notes/settings.json"]);
    expect(await store.load()).toBe('{"theme":"oneDark"}');
  });
});

describe("deleteNextcloudNamespace", () => {
  it("removes the namespace's whole folder and leaves the others alone", async () => {
    const server = fakeNextcloud();
    await createNextcloudAdapter(CONFIG, server.fetchImpl, "work").save(
      serialize({ notes: [plainNote({ title: "Report" })] }),
    );
    await createNextcloudAdapter(CONFIG, server.fetchImpl).save(
      serialize({ notes: [plainNote({ title: "Personal" })] }),
    );

    await deleteNextcloudNamespace(CONFIG, "work", server.fetchImpl);

    expect(server.paths().some((p) => p.startsWith("notes/work/"))).toBe(false);
    expect(server.paths().some((p) => p.startsWith("notes/notes/"))).toBe(true);
  });

  it("never deletes the default namespace, which shares the app-folder root", async () => {
    const server = fakeNextcloud();
    await createNextcloudAdapter(CONFIG, server.fetchImpl).save(
      serialize({ notes: [plainNote()] }),
    );
    await deleteNextcloudNamespace(CONFIG, "default", server.fetchImpl);
    expect(server.paths()).toHaveLength(1);
  });
});

describe("verifyNextcloudConnection", () => {
  it("accepts working credentials and creates the app folder", async () => {
    const server = fakeNextcloud();
    await verifyNextcloudConnection(CONFIG, server.fetchImpl);
    expect(server.dirs.has("notes")).toBe(true);
  });

  it("rejects a refused app password with an AuthError the form can show", async () => {
    const server = fakeNextcloud({ status: 401 });
    await expect(
      verifyNextcloudConnection(CONFIG, server.fetchImpl),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("explains a server that can't be reached at all", async () => {
    const unreachable = (() =>
      Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch;
    await expect(
      verifyNextcloudConnection(CONFIG, unreachable),
    ).rejects.toThrow(/Couldn't reach https:\/\/cloud\.test/);
  });
});
