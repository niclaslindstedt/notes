// Direct tests for the shared Drive folder plumbing. The request-sequence
// contract of the stores built on top of it is pinned in
// gdrive-store.test.ts; these cover the parts only reachable with a
// multi-segment base folder — the segment walk, the create chain, and the
// folder-id cache.

import { describe, expect, it } from "vitest";

import {
  createDriveFolderFs,
  dirAndName,
} from "../../src/storage/gdrive/drive-fs.ts";

const FILES_API = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

type Scripted = { status?: number; json?: unknown };
type Call = { url: string; method: string; body: BodyInit | null | undefined };

function scriptedFetch(responses: Scripted[]) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request: ${String(input)}`);
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body,
    });
    return new Response(JSON.stringify(next.json ?? {}), {
      status: next.status ?? 200,
    });
  }) as typeof fetch;
  return { impl, calls };
}

function searchUrl(query: string, fields: string, pageToken?: string): string {
  return (
    `${FILES_API}?q=${encodeURIComponent(query)}&spaces=drive` +
    `&fields=files(${fields}),nextPageToken&pageSize=1000` +
    (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "")
  );
}

function folderSearchUrl(name: string, parentId: string): string {
  return searchUrl(
    `name='${name}' and mimeType='${FOLDER_MIME}'` +
      ` and '${parentId}' in parents and trashed=false`,
    "id",
  );
}

describe("dirAndName", () => {
  it("splits a root-level path", () => {
    expect(dirAndName("note.md")).toEqual({ dir: "", name: "note.md" });
  });

  it("splits a nested path at the last slash", () => {
    expect(dirAndName("work/todo/note.md")).toEqual({
      dir: "work/todo",
      name: "note.md",
    });
  });
});

describe("createDriveFolderFs", () => {
  it("resolveDirId walks base segments then relDir segments in order", async () => {
    const { impl, calls } = scriptedFetch([
      { json: { files: [{ id: "app1" }] } },
      { json: { files: [{ id: "ws1" }] } },
      { json: { files: [{ id: "att1" }] } },
      { json: { files: [{ id: "note1" }] } },
    ]);
    const fs = createDriveFolderFs("tok", impl, "ws/attachments");

    await expect(fs.resolveDirId("my-note", false)).resolves.toBe("note1");

    expect(calls.map((c) => c.url)).toEqual([
      folderSearchUrl("notes", "root"),
      folderSearchUrl("ws", "app1"),
      folderSearchUrl("attachments", "ws1"),
      folderSearchUrl("my-note", "att1"),
    ]);
  });

  it("resolveDirId creates every missing segment when create is set", async () => {
    const { impl, calls } = scriptedFetch([
      { json: { files: [{ id: "app1" }] } },
      { json: { files: [] } },
      { json: { id: "ws1" } },
      { json: { files: [] } },
      { json: { id: "note1" } },
    ]);
    const fs = createDriveFolderFs("tok", impl, "ws");

    await expect(fs.resolveDirId("my-note", true)).resolves.toBe("note1");

    const creates = calls.filter((c) => c.method === "POST");
    expect(creates.map((c) => JSON.parse(String(c.body)))).toEqual([
      { name: "ws", mimeType: FOLDER_MIME, parents: ["app1"] },
      { name: "my-note", mimeType: FOLDER_MIME, parents: ["ws1"] },
    ]);
  });

  it("resolveDirId returns null at the first missing segment without creating", async () => {
    const { impl, calls } = scriptedFetch([
      { json: { files: [{ id: "app1" }] } },
      { json: { files: [] } },
    ]);
    const fs = createDriveFolderFs("tok", impl, "ws");

    await expect(fs.resolveDirId("", false)).resolves.toBeNull();
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("resolveDirId caches resolved ids per relative directory", async () => {
    const { impl, calls } = scriptedFetch([
      { json: { files: [{ id: "app1" }] } },
      { json: { files: [{ id: "ws1" }] } },
    ]);
    const fs = createDriveFolderFs("tok", impl, "ws");

    await expect(fs.resolveDirId("", false)).resolves.toBe("ws1");
    await expect(fs.resolveDirId("", false)).resolves.toBe("ws1");
    expect(calls).toHaveLength(2);
  });

  it("findFileId resolves the directory then searches for the file", async () => {
    const { impl, calls } = scriptedFetch([
      { json: { files: [{ id: "app1" }] } },
      { json: { files: [{ id: "f1" }] } },
    ]);
    const fs = createDriveFolderFs("tok", impl);

    await expect(fs.findFileId("", "a.md")).resolves.toBe("f1");

    const fileQuery = `name='a.md' and 'app1' in parents and trashed=false`;
    expect(calls[1]?.url).toBe(searchUrl(fileQuery, "id"));
  });

  it("findFileId returns null when the directory itself is absent", async () => {
    const { impl, calls } = scriptedFetch([{ json: { files: [] } }]);
    const fs = createDriveFolderFs("tok", impl);

    await expect(fs.findFileId("", "a.md")).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("search follows nextPageToken and concatenates every page", async () => {
    const { impl, calls } = scriptedFetch([
      {
        json: {
          files: [{ id: "a", name: "a.md" }],
          nextPageToken: "page2",
        },
      },
      {
        json: {
          files: [{ id: "b", name: "b.md" }],
          nextPageToken: "page3",
        },
      },
      { json: { files: [{ id: "c", name: "c.md" }] } },
    ]);
    const fs = createDriveFolderFs("tok", impl);
    const query = `'dir1' in parents and trashed=false`;

    const files = await fs.search(query, "id,name");

    expect(files.map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(calls.map((c) => c.url)).toEqual([
      searchUrl(query, "id,name"),
      searchUrl(query, "id,name", "page2"),
      searchUrl(query, "id,name", "page3"),
    ]);
  });

  it("search stops when a page carries no nextPageToken", async () => {
    const { impl, calls } = scriptedFetch([{ json: { files: [] } }]);
    const fs = createDriveFolderFs("tok", impl);

    await expect(fs.search("q", "id")).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
  });
});
