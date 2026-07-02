// Pins the shared Dropbox `list_folder` walk extracted from the two stores:
// the has_more/cursor pagination, the `.tag === "file"` filter, the root-prefix
// scoping via `relativePath`, and the caller's per-entry `map` (the file store's
// shallow-vs-recursive shape, the attachment store's nested-only filter). This
// is the seam both `createDropboxFileStore` and `createDropboxAttachmentStore`
// now run through, so covering it here covers both stores' listings.

import { describe, expect, it } from "vitest";

import {
  type AuthedFetch,
  type DropboxEntry,
  listAllFiles,
  relativePath,
} from "../../src/storage/dropbox/list.ts";

const LIST = "https://api.dropboxapi.com/2/files/list_folder";
const CONTINUE = "https://api.dropboxapi.com/2/files/list_folder/continue";

type Scripted = { status?: number; json?: unknown; text?: string };

type Call = { url: string; body: unknown };

// A fake AuthedFetch that replays scripted responses and records each call's
// URL and parsed JSON body. `map`/`list` never inspect the token, so the
// builder is invoked with a dummy one.
function scriptedAuthedFetch(responses: Scripted[]): {
  authedFetch: AuthedFetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const authedFetch: AuthedFetch = async (url, build) => {
    const init = build("tok");
    calls.push({
      url,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request: ${url}`);
    return new Response(next.text ?? JSON.stringify(next.json ?? {}), {
      status: next.status ?? 200,
    });
  };
  return { authedFetch, calls };
}

function file(path: string, rev?: string): DropboxEntry {
  return { ".tag": "file", path_display: path, rev };
}

describe("relativePath", () => {
  it("returns the path below the root prefix", () => {
    expect(relativePath(file("/notes/a.md"), "/notes/")).toBe("a.md");
  });

  it("matches case-insensitively but slices off the display-cased original", () => {
    expect(relativePath(file("/Notes/A.md"), "/notes/")).toBe("A.md");
  });

  it("returns null for an entry outside the root", () => {
    expect(relativePath(file("/other/a.md"), "/notes/")).toBeNull();
  });

  it("returns null for an entry with no path", () => {
    expect(relativePath({ ".tag": "file" }, "/notes/")).toBeNull();
  });
});

describe("listAllFiles", () => {
  const collectAll = (_e: DropboxEntry, path: string) => ({ path });

  it("returns [] and hits list_folder once for an absent folder (409)", async () => {
    const { authedFetch, calls } = scriptedAuthedFetch([{ status: 409 }]);
    const out = await listAllFiles(
      authedFetch,
      "/notes",
      false,
      "/notes/",
      collectAll,
    );
    expect(out).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(LIST);
    expect(calls[0]!.body).toEqual({ path: "/notes", recursive: false });
  });

  it("follows has_more via the continue cursor until exhausted", async () => {
    const { authedFetch, calls } = scriptedAuthedFetch([
      {
        json: {
          entries: [file("/notes/a.md")],
          cursor: "c1",
          has_more: true,
        },
      },
      {
        json: {
          entries: [file("/notes/b.md")],
          cursor: "c2",
          has_more: false,
        },
      },
    ]);
    const out = await listAllFiles(
      authedFetch,
      "/notes",
      false,
      "/notes/",
      collectAll,
    );
    expect(out).toEqual([{ path: "a.md" }, { path: "b.md" }]);
    expect(calls.map((c) => c.url)).toEqual([LIST, CONTINUE]);
    expect(calls[1]!.body).toEqual({ cursor: "c1" });
  });

  it("skips folder/deleted entries and paths outside the root", async () => {
    const { authedFetch } = scriptedAuthedFetch([
      {
        json: {
          entries: [
            file("/notes/a.md"),
            { ".tag": "folder", path_display: "/notes/sub" },
            { ".tag": "deleted", path_display: "/notes/gone.md" },
            file("/elsewhere/x.md"),
          ],
          cursor: "",
          has_more: false,
        },
      },
    ]);
    const out = await listAllFiles(
      authedFetch,
      "/notes",
      false,
      "/notes/",
      collectAll,
    );
    expect(out).toEqual([{ path: "a.md" }]);
  });

  it("drops entries the map rejects (file store's shallow filter)", async () => {
    const { authedFetch } = scriptedAuthedFetch([
      {
        json: {
          entries: [file("/notes/a.md", "r1"), file("/notes/sub/b.md", "r2")],
          cursor: "",
          has_more: false,
        },
      },
    ]);
    // Mirror the file store's shallow map: keep top-level files, carry the rev.
    const out = await listAllFiles(
      authedFetch,
      "/notes",
      false,
      "/notes/",
      (entry, path) => (!path.includes("/") ? { path, rev: entry.rev } : null),
    );
    expect(out).toEqual([{ path: "a.md", rev: "r1" }]);
  });

  it("keeps only nested files for the attachment store's recursive map", async () => {
    const { authedFetch, calls } = scriptedAuthedFetch([
      {
        json: {
          entries: [
            file("/attachments/note-1/img.png"),
            file("/attachments/top.png"),
          ],
          cursor: "",
          has_more: false,
        },
      },
    ]);
    const out = await listAllFiles(
      authedFetch,
      "/attachments",
      true,
      "/attachments/",
      (_entry, path) => (path.includes("/") ? { path } : null),
    );
    expect(out).toEqual([{ path: "note-1/img.png" }]);
    // Recursive listing is requested up front.
    expect(calls[0]!.body).toEqual({ path: "/attachments", recursive: true });
  });

  it("throws on a non-409 error status", async () => {
    const { authedFetch } = scriptedAuthedFetch([
      { status: 500, text: "server error" },
    ]);
    await expect(
      listAllFiles(authedFetch, "/notes", false, "/notes/", collectAll),
    ).rejects.toThrow(/Dropbox list_folder failed: 500/);
  });
});
