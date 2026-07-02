// Shared Dropbox `list_folder` machinery: the paginated directory walk that
// both the note file store and the attachment store run. Factored out of
// `index.ts` so the two stores don't each carry their own byte-identical copy
// of `relativePath` + `listOnce` + the `has_more`/`cursor` loop. The walk is
// parameterised by the authed fetch and the store's root prefix; the per-entry
// accept/shape decision stays with each caller via the `map` callback.

import { readErrorBody } from "../http-utils.ts";

const LIST_FOLDER_ENDPOINT = "https://api.dropboxapi.com/2/files/list_folder";
const LIST_FOLDER_CONTINUE_ENDPOINT =
  "https://api.dropboxapi.com/2/files/list_folder/continue";

// The bearer-token fetch the stores run on (issued by `createAuthedFetch` in
// `index.ts`): given a URL and a builder that stamps the current access token
// onto the request, it retries once through a silent refresh on a 401.
export type AuthedFetch = (
  url: string,
  build: (token: string) => RequestInit,
) => Promise<Response>;

export type DropboxEntry = {
  ".tag": "file" | "folder" | "deleted";
  path_display?: string;
  path_lower?: string;
  rev?: string;
};

type ListFolderResult = {
  entries: DropboxEntry[];
  cursor: string;
  has_more: boolean;
};

// Path of `entry` relative to `rootPrefix` (a lowercased `<root>/`), or null
// when the entry carries no path or sits outside the root.
export function relativePath(
  entry: DropboxEntry,
  rootPrefix: string,
): string | null {
  const full = entry.path_display ?? entry.path_lower;
  if (!full) return null;
  if (full.toLowerCase().startsWith(rootPrefix)) {
    return full.slice(rootPrefix.length);
  }
  return null;
}

async function listOnce(
  authedFetch: AuthedFetch,
  endpoint: string,
  body: unknown,
): Promise<ListFolderResult | null> {
  const res = await authedFetch(endpoint, (token) => ({
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }));
  if (res.status === 409) return null; // path/not_found — empty folder
  if (!res.ok) {
    const detail = await readErrorBody(res);
    throw new Error(`Dropbox list_folder failed: ${res.status} ${detail}`);
  }
  return (await res.json()) as ListFolderResult;
}

// Walk a Dropbox folder to exhaustion (following `has_more`/`cursor`), keeping
// each `file` entry the caller's `map` accepts. `map` receives the entry and
// its path relative to the root; returning null drops it. A 409 on the first
// page (an absent folder) yields an empty list.
export async function listAllFiles<T>(
  authedFetch: AuthedFetch,
  rootPath: string,
  recursive: boolean,
  rootPrefix: string,
  map: (entry: DropboxEntry, relPath: string) => T | null,
): Promise<T[]> {
  let page = await listOnce(authedFetch, LIST_FOLDER_ENDPOINT, {
    path: rootPath,
    recursive,
  });
  if (!page) return [];
  const out: T[] = [];
  for (;;) {
    for (const entry of page.entries) {
      if (entry[".tag"] !== "file") continue;
      const rel = relativePath(entry, rootPrefix);
      if (!rel) continue;
      const mapped = map(entry, rel);
      if (mapped !== null) out.push(mapped);
    }
    if (!page.has_more) break;
    const next = await listOnce(authedFetch, LIST_FOLDER_CONTINUE_ENDPOINT, {
      cursor: page.cursor,
    });
    if (!next) break;
    page = next;
  }
  return out;
}
