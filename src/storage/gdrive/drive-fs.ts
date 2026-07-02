// Shared Google Drive folder plumbing. Drive has no paths — every segment of
// a path is a folder whose id must be searched for (and possibly created)
// before a file under it can be touched — so every store this backend builds
// (the notes / settings / registry file stores and the attachment store)
// needs the same search / create-folder / resolve-directory bookkeeping.
// `createDriveFolderFs` owns that plumbing once; each store instance keeps
// its own folder-id cache because the ids it resolves are relative to that
// store's base folder.

import { AuthError, RateLimitError } from "../adapter.ts";
import { parseRetryAfterMs, readErrorBody } from "../http-utils.ts";

// Name of the app folder at the root of the user's My Drive. All files this
// backend manages live inside it.
export const GDRIVE_APP_FOLDER_NAME = "notes";

export const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
export const DRIVE_FILES_API = "https://www.googleapis.com/drive/v3/files";
export const DRIVE_UPLOAD_API =
  "https://www.googleapis.com/upload/drive/v3/files";

// Floor for the cooldown after Drive rate-limits a request, used when the
// response carries no usable `Retry-After`.
const RATE_LIMIT_FALLBACK_MS = 5000;

export type FetchImpl = typeof fetch;

export type DriveFile = {
  id: string;
  name?: string;
  mimeType?: string;
  version?: string;
};
export type DriveListResponse = {
  files?: DriveFile[];
  nextPageToken?: string;
};

// Drive's `files.list` maximum page size. Listings must still follow
// `nextPageToken` — Drive may return fewer items than this per page (it
// treats the size as a hint), so a missing token is the only reliable
// end-of-listing signal.
const LIST_PAGE_SIZE = 1000;

// Unlike Dropbox's clean 429, Google Drive signals a rate limit mostly as
// HTTP 403 with a structured `reason` in the JSON body. A bare 429 counts
// too. A 403 quota-exhaustion (`dailyLimitExceeded`) is deliberately NOT
// treated as a transient throttle: that's a hard cap, not "retry shortly".
function isDriveRateLimit(status: number, body: string): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  return (
    body.includes("userRateLimitExceeded") || body.includes("rateLimitExceeded")
  );
}

export function gdriveError(
  op: string,
  status: number,
  body: string,
  headers?: Headers,
): Error {
  if (isDriveRateLimit(status, body)) {
    return new RateLimitError(
      parseRetryAfterMs(headers, RATE_LIMIT_FALLBACK_MS),
    );
  }
  const message = `Google Drive ${op} failed: ${status} ${body}`;
  return status === 401 ? new AuthError(message) : new Error(message);
}

/** Split a `/`-joined relative path into its non-empty segments. */
function split(relDir: string): string[] {
  return relDir.split("/").filter((s) => s.length > 0);
}

/** Split a relative path into its parent directory ("" = root) and name. */
export function dirAndName(path: string): { dir: string; name: string } {
  const idx = path.lastIndexOf("/");
  return idx === -1
    ? { dir: "", name: path }
    : { dir: path.slice(0, idx), name: path.slice(idx + 1) };
}

function childFolderQuery(name: string, parentId: string): string {
  return (
    `name='${name}' and mimeType='${FOLDER_MIME_TYPE}'` +
    ` and '${parentId}' in parents and trashed=false`
  );
}

/** Drive search query for a (non-folder) file `name` under `parentId`. */
export function childFileQuery(name: string, parentId: string): string {
  return `name='${name}' and '${parentId}' in parents and trashed=false`;
}

export type DriveFolderFs = {
  /** The bearer header every Drive request carries. */
  authHeader(): Record<string, string>;
  /** Run a Drive `files.list` search; `op` names the operation in errors. */
  search(query: string, fields: string, op?: string): Promise<DriveFile[]>;
  /** `search` narrowed to the first match's id (or null). */
  searchOneId(query: string, op?: string): Promise<string | null>;
  /** Create a folder under `parentId` (null = My Drive root); returns its id. */
  createFolder(name: string, parentId: string | null): Promise<string>;
  /**
   * Resolve the id of the directory at `relDir` under this store's base
   * ("" = the base itself), creating each missing segment when `create` is
   * set. Returns null when a segment is absent and `create` is false.
   */
  resolveDirId(relDir: string, create: boolean): Promise<string | null>;
  /** Resolve the id of file `name` under `dir`, or null when absent. */
  findFileId(dir: string, name: string): Promise<string | null>;
};

export function createDriveFolderFs(
  token: string,
  fetchImpl: FetchImpl,
  baseFolder = "",
): DriveFolderFs {
  // The folder, relative to the `notes/` app folder, this store is rooted at
  // (e.g. `<slug>/notes` for a namespace's documents, `attachments` for the
  // default namespace's images, or empty for the root settings / registry
  // stores). Split into segments so a multi-segment base resolves folder by
  // folder.
  const baseSegments = split(baseFolder);
  // Cache folder ids by their relative directory path ("" = the store's base
  // folder). Drive ids are stable, so this only ever grows within a store's
  // lifetime.
  const dirIdCache = new Map<string, string>();

  function authHeader(): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  async function search(
    query: string,
    fields: string,
    op = "search",
  ): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const url =
        `${DRIVE_FILES_API}?q=${encodeURIComponent(query)}&spaces=drive` +
        `&fields=files(${fields}),nextPageToken&pageSize=${LIST_PAGE_SIZE}` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
      const res = await fetchImpl(url, { headers: authHeader() });
      if (!res.ok) {
        const body = await readErrorBody(res);
        throw gdriveError(op, res.status, body, res.headers);
      }
      const page = (await res.json()) as DriveListResponse;
      out.push(...(page.files ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out;
  }

  async function searchOneId(
    query: string,
    op?: string,
  ): Promise<string | null> {
    return (await search(query, "id", op))[0]?.id ?? null;
  }

  async function createFolder(
    name: string,
    parentId: string | null,
  ): Promise<string> {
    const body: Record<string, unknown> = { name, mimeType: FOLDER_MIME_TYPE };
    if (parentId) body.parents = [parentId];
    const res = await fetchImpl(`${DRIVE_FILES_API}?fields=id`, {
      method: "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await readErrorBody(res);
      throw gdriveError("folder create", res.status, detail, res.headers);
    }
    return ((await res.json()) as DriveFile).id;
  }

  async function resolveDirId(
    relDir: string,
    create: boolean,
  ): Promise<string | null> {
    const cached = dirIdCache.get(relDir);
    if (cached !== undefined) return cached;

    let parentId = await searchOneId(
      childFolderQuery(GDRIVE_APP_FOLDER_NAME, "root"),
    );
    if (!parentId) {
      if (!create) return null;
      parentId = await createFolder(GDRIVE_APP_FOLDER_NAME, null);
    }

    // An empty base resolves at the app-folder root (the root settings /
    // registry stores), so the segments drop out and files land directly in
    // the `notes/` app folder.
    for (const segment of [...baseSegments, ...split(relDir)]) {
      let id = await searchOneId(childFolderQuery(segment, parentId));
      if (!id) {
        if (!create) return null;
        id = await createFolder(segment, parentId);
      }
      parentId = id;
    }
    dirIdCache.set(relDir, parentId);
    return parentId;
  }

  async function findFileId(dir: string, name: string): Promise<string | null> {
    const dirId = await resolveDirId(dir, false);
    if (!dirId) return null;
    return searchOneId(childFileQuery(name, dirId));
  }

  return {
    authHeader,
    search,
    searchOneId,
    createFolder,
    resolveDirId,
    findFileId,
  };
}
