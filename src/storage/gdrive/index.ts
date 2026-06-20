// Google-Drive-backed `StorageAdapter`. Talks to the Drive v3 REST API
// directly (no SDK). The notes become individual markdown files under a
// `notes/` app folder in the user's My Drive, so they're visible and editable
// from drive.google.com and any tool the user syncs the folder into.
//
// The markdown <-> snapshot conversion, the encrypted-blob fallback, and
// conflict detection live in the shared directory adapter
// (`../directory-adapter.ts`); this module implements the small `FileStore`
// that moves one file at a time over Drive's API plus the folder-id
// bookkeeping Drive requires, and the GIS OAuth flow. Encryption happens one
// level up in `withEncryption`, so an encrypted store lands as a single
// `notes.json` envelope in the app folder rather than markdown.

import { createLogger } from "../../dev/logger.ts";
import { AuthError, RateLimitError, type StorageAdapter } from "../adapter.ts";
import type { AttachmentEntry, AttachmentStore } from "../attachment-store.ts";
import {
  type DirectoryCrypto,
  createDirectoryAdapter,
} from "../directory-adapter.ts";
import type { FileEntry, FileStore } from "../file-store.ts";
import {
  DEFAULT_NAMESPACE_SLUG,
  namespaceAttachmentsFolder,
  namespaceCloudFolder,
  namespaceNotesFolder,
} from "../namespaces.ts";
import {
  fileNamespaceStore,
  type NamespaceRegistryStore,
} from "../namespace-store.ts";
import { fileSettingsStore, type SettingsStore } from "../settings-store.ts";
import { parseRetryAfterMs, readErrorBody } from "../http-utils.ts";

const log = createLogger("gdrive");

// Public OAuth client id, read from a build-time env var so a fork can plug
// in its own Google Cloud project. Unset means the Google Drive backend is
// disabled in the picker.
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

export function isGdriveConfigured(): boolean {
  return GOOGLE_CLIENT_ID.length > 0;
}

// Name of the app folder at the root of the user's My Drive. All files this
// adapter manages live inside it.
export const GDRIVE_APP_FOLDER_NAME = "notes";

// `drive.file` lets the app see and manage only files it created. Files stay
// visible to the user in Drive's UI.
export const GDRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const DRIVE_FILES_API = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";

const SAVE_DEBOUNCE_MS = 1000;

// Floor for the cooldown after Drive rate-limits a request, used when the
// response carries no usable `Retry-After`.
const RATE_LIMIT_FALLBACK_MS = 5000;

export type FetchImpl = typeof fetch;

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

function gdriveError(
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

// Returns a URL that opens Drive's web UI (the app folder, or My Drive when
// the folder id isn't known here).
export function gdriveWebUrl(folderId: string | null): string {
  return folderId
    ? `https://drive.google.com/drive/folders/${folderId}`
    : "https://drive.google.com/drive/my-drive";
}

type DriveFile = {
  id: string;
  name?: string;
  mimeType?: string;
  version?: string;
};
type DriveListResponse = { files?: DriveFile[] };

export function createGdriveAdapter(
  token: string,
  fetchImpl: FetchImpl = fetch,
  namespace: string = DEFAULT_NAMESPACE_SLUG,
  crypto?: DirectoryCrypto,
): StorageAdapter {
  log.info(`adapter created hasToken=${Boolean(token)} ns=${namespace}`);
  const store = createGdriveFileStore(
    token,
    fetchImpl,
    namespaceNotesFolder(namespace),
  );
  const attachments = createGdriveAttachmentStore(
    token,
    fetchImpl,
    namespaceAttachmentsFolder(namespace),
  );
  return createDirectoryAdapter(
    store,
    {
      id: "gdrive",
      label: "Google Drive",
      saveDebounceMs: SAVE_DEBOUNCE_MS,
    },
    attachments,
    crypto,
  );
}

// Settings store for the Google Drive backend: `settings.json` in the
// `notes/` app folder, beside the namespace folders. Built with no namespace
// so the file store resolves at the app-folder root.
export function createGdriveSettingsStore(
  token: string,
  fetchImpl: FetchImpl = fetch,
): SettingsStore {
  return fileSettingsStore(createGdriveFileStore(token, fetchImpl, ""));
}

// Root namespace-registry store for the Google Drive backend:
// `namespaces.json` in the `notes/` app folder, beside `settings.json` and
// the namespace folders. Built with no namespace so the file store resolves
// at the app-folder root.
export function createGdriveNamespaceStore(
  token: string,
  fetchImpl: FetchImpl = fetch,
): NamespaceRegistryStore {
  return fileNamespaceStore(createGdriveFileStore(token, fetchImpl, ""));
}

function createGdriveFileStore(
  token: string,
  fetchImpl: FetchImpl,
  baseFolder: string = "",
): FileStore {
  // The folder, relative to the `notes/` app folder, this store is rooted at:
  // `notes` / `<slug>/notes` for a namespace's documents, or empty for the
  // root settings / registry stores that land directly in the app folder.
  // Split into segments so a multi-segment base resolves folder by folder.
  const baseSegments = split(baseFolder);
  // Cache folder ids by their relative directory path ("" = the namespace's
  // base folder). Drive ids are stable, so this only ever grows within an
  // adapter's lifetime.
  const dirIdCache = new Map<string, string>();

  function authHeader(): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  async function searchOne(query: string): Promise<string | null> {
    const url = `${DRIVE_FILES_API}?q=${encodeURIComponent(
      query,
    )}&spaces=drive&fields=files(id)`;
    const res = await fetchImpl(url, { headers: authHeader() });
    if (!res.ok) {
      const body = await readErrorBody(res);
      throw gdriveError("search", res.status, body, res.headers);
    }
    const json = (await res.json()) as DriveListResponse;
    return json.files?.[0]?.id ?? null;
  }

  async function findChildFolder(
    name: string,
    parentId: string,
  ): Promise<string | null> {
    return searchOne(
      `name='${name}' and mimeType='${FOLDER_MIME_TYPE}'` +
        ` and '${parentId}' in parents and trashed=false`,
    );
  }

  async function findChildFolderAtRoot(name: string): Promise<string | null> {
    return searchOne(
      `name='${name}' and mimeType='${FOLDER_MIME_TYPE}'` +
        ` and 'root' in parents and trashed=false`,
    );
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

  // Resolve the id of the directory at `relDir` ("" = the app folder),
  // creating each missing segment when `create` is set. Returns null when a
  // segment is absent and `create` is false.
  async function resolveDirId(
    relDir: string,
    create: boolean,
  ): Promise<string | null> {
    if (dirIdCache.has(relDir)) return dirIdCache.get(relDir)!;

    let appId = await findChildFolderAtRoot(GDRIVE_APP_FOLDER_NAME);
    if (!appId) {
      if (!create) return null;
      appId = await createFolder(GDRIVE_APP_FOLDER_NAME, null);
    }

    let parentId = appId;
    // An empty base resolves at the app-folder root (the root settings /
    // registry stores), so the segments drop out and files land directly in
    // the `notes/` app folder.
    for (const segment of [...baseSegments, ...split(relDir)].filter(
      (s) => s.length > 0,
    )) {
      let id = await findChildFolder(segment, parentId);
      if (!id) {
        if (!create) return null;
        id = await createFolder(segment, parentId);
      }
      parentId = id;
    }
    dirIdCache.set(relDir, parentId);
    return parentId;
  }

  // List the files directly in a directory. Non-recursive: notes are stored
  // flat (one `.md` per note, no nesting), so folders are skipped rather than
  // descended into — which keeps the default namespace, rooted at the `notes/`
  // app folder, from picking up other namespaces' subfolders.
  async function listDir(dirId: string, out: FileEntry[]): Promise<void> {
    const query = `'${dirId}' in parents and trashed=false`;
    const url =
      `${DRIVE_FILES_API}?q=${encodeURIComponent(query)}&spaces=drive` +
      `&fields=files(id,name,mimeType,version)`;
    const res = await fetchImpl(url, { headers: authHeader() });
    if (!res.ok) {
      const body = await readErrorBody(res);
      throw gdriveError("list", res.status, body, res.headers);
    }
    const files = ((await res.json()) as DriveListResponse).files ?? [];
    for (const file of files) {
      if (file.mimeType === FOLDER_MIME_TYPE) continue;
      out.push({ path: file.name ?? "", rev: file.version });
    }
  }

  function dirAndName(path: string): { dir: string; name: string } {
    const idx = path.lastIndexOf("/");
    return idx === -1
      ? { dir: "", name: path }
      : { dir: path.slice(0, idx), name: path.slice(idx + 1) };
  }

  async function findFileId(path: string): Promise<string | null> {
    const { dir, name } = dirAndName(path);
    const dirId = await resolveDirId(dir, false);
    if (!dirId) return null;
    return searchOne(
      `name='${name}' and '${dirId}' in parents and trashed=false`,
    );
  }

  async function createFile(
    parentId: string,
    name: string,
    text: string,
  ): Promise<string | undefined> {
    const meta = JSON.stringify({ name, parents: [parentId] });
    const boundary = `notes-${randomBoundary()}`;
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/markdown\r\n\r\n${text}\r\n` +
      `--${boundary}--`;
    const res = await fetchImpl(
      `${DRIVE_UPLOAD_API}?uploadType=multipart&fields=version`,
      {
        method: "POST",
        headers: {
          ...authHeader(),
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );
    if (!res.ok) {
      const errBody = await readErrorBody(res);
      throw gdriveError("create", res.status, errBody, res.headers);
    }
    return ((await res.json()) as DriveFile).version;
  }

  return {
    async list(): Promise<FileEntry[]> {
      const baseId = await resolveDirId("", false);
      if (!baseId) return [];
      const out: FileEntry[] = [];
      await listDir(baseId, out);
      return out;
    },

    async read(path: string): Promise<string | null> {
      const fileId = await findFileId(path);
      if (!fileId) return null;
      const res = await fetchImpl(`${DRIVE_FILES_API}/${fileId}?alt=media`, {
        headers: authHeader(),
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        const body = await readErrorBody(res);
        throw gdriveError("download", res.status, body, res.headers);
      }
      return res.text();
    },

    async write(path: string, text: string): Promise<string | undefined> {
      const { dir, name } = dirAndName(path);
      const dirId = await resolveDirId(dir, true);
      if (!dirId) throw new Error(`Google Drive: cannot resolve ${dir}`);
      const existing = await searchOne(
        `name='${name}' and '${dirId}' in parents and trashed=false`,
      );
      if (existing) {
        const res = await fetchImpl(
          `${DRIVE_UPLOAD_API}/${existing}?uploadType=media&fields=version`,
          {
            method: "PATCH",
            headers: { ...authHeader(), "Content-Type": "text/markdown" },
            body: text,
          },
        );
        if (!res.ok) {
          const body = await readErrorBody(res);
          throw gdriveError("update", res.status, body, res.headers);
        }
        // Drive bumps `version` on every change; it's what `list()` reports,
        // so returning it lets the adapter skip an eventually-consistent
        // re-list to learn the post-save revision.
        return ((await res.json()) as DriveFile).version;
      }
      return createFile(dirId, name, text);
    },

    async remove(path: string): Promise<void> {
      const fileId = await findFileId(path);
      if (!fileId) return;
      const res = await fetchImpl(`${DRIVE_FILES_API}/${fileId}`, {
        method: "DELETE",
        headers: authHeader(),
      });
      if (!res.ok && res.status !== 404) {
        const body = await readErrorBody(res);
        throw gdriveError("delete", res.status, body, res.headers);
      }
    },
  };
}

// Binary attachment store for Google Drive: a note's images under the
// `attachments/<note-name>/` tree inside the `notes/` app folder (a sibling of
// the notes' own subfolder). Mirrors the file store's folder-id bookkeeping
// but moves raw image bytes, so uploads are binary-safe (a `Blob` body for the
// multipart create, the raw bytes for a media update).
function createGdriveAttachmentStore(
  token: string,
  fetchImpl: FetchImpl,
  baseFolder: string,
): AttachmentStore {
  const baseSegments = split(baseFolder);
  const dirIdCache = new Map<string, string>();

  function authHeader(): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  async function search(query: string, fields: string): Promise<DriveFile[]> {
    const url =
      `${DRIVE_FILES_API}?q=${encodeURIComponent(query)}&spaces=drive` +
      `&fields=files(${fields})`;
    const res = await fetchImpl(url, { headers: authHeader() });
    if (!res.ok) {
      const body = await readErrorBody(res);
      throw gdriveError("search", res.status, body, res.headers);
    }
    return ((await res.json()) as DriveListResponse).files ?? [];
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

  // Resolve (optionally creating) the id of the directory at `relDir` under the
  // attachments base — `""` is the base itself, `<note-name>` an image folder.
  async function resolveDirId(
    relDir: string,
    create: boolean,
  ): Promise<string | null> {
    if (dirIdCache.has(relDir)) return dirIdCache.get(relDir)!;
    const rootMatches = await search(
      `name='${GDRIVE_APP_FOLDER_NAME}' and mimeType='${FOLDER_MIME_TYPE}'` +
        ` and 'root' in parents and trashed=false`,
      "id",
    );
    let parentId = rootMatches[0]?.id ?? null;
    if (!parentId) {
      if (!create) return null;
      parentId = await createFolder(GDRIVE_APP_FOLDER_NAME, null);
    }
    for (const segment of [...baseSegments, ...split(relDir)]) {
      const matches = await search(
        `name='${segment}' and mimeType='${FOLDER_MIME_TYPE}'` +
          ` and '${parentId}' in parents and trashed=false`,
        "id",
      );
      let id = matches[0]?.id ?? null;
      if (!id) {
        if (!create) return null;
        id = await createFolder(segment, parentId);
      }
      parentId = id;
    }
    dirIdCache.set(relDir, parentId);
    return parentId;
  }

  async function findFileId(
    relDir: string,
    name: string,
  ): Promise<string | null> {
    const dirId = await resolveDirId(relDir, false);
    if (!dirId) return null;
    const matches = await search(
      `name='${name}' and '${dirId}' in parents and trashed=false`,
      "id",
    );
    return matches[0]?.id ?? null;
  }

  function dirAndName(path: string): { dir: string; name: string } {
    const idx = path.lastIndexOf("/");
    return idx === -1
      ? { dir: "", name: path }
      : { dir: path.slice(0, idx), name: path.slice(idx + 1) };
  }

  return {
    async list(): Promise<AttachmentEntry[]> {
      const baseId = await resolveDirId("", false);
      if (!baseId) return [];
      const subdirs = await search(
        `'${baseId}' in parents and mimeType='${FOLDER_MIME_TYPE}'` +
          ` and trashed=false`,
        "id,name",
      );
      const out: AttachmentEntry[] = [];
      for (const dir of subdirs) {
        const files = await search(
          `'${dir.id}' in parents and trashed=false`,
          "id,name,mimeType",
        );
        for (const file of files) {
          if (file.mimeType === FOLDER_MIME_TYPE) continue;
          out.push({ path: `${dir.name}/${file.name}` });
        }
      }
      return out;
    },

    async read(path: string): Promise<Uint8Array | null> {
      const { dir, name } = dirAndName(path);
      const fileId = await findFileId(dir, name);
      if (!fileId) return null;
      const res = await fetchImpl(`${DRIVE_FILES_API}/${fileId}?alt=media`, {
        headers: authHeader(),
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        const body = await readErrorBody(res);
        throw gdriveError("download", res.status, body, res.headers);
      }
      return new Uint8Array(await res.arrayBuffer());
    },

    async write(
      path: string,
      bytes: Uint8Array<ArrayBuffer>,
      mime: string,
    ): Promise<void> {
      const { dir, name } = dirAndName(path);
      const dirId = await resolveDirId(dir, true);
      if (!dirId) throw new Error(`Google Drive: cannot resolve ${dir}`);
      const existing = await findFileId(dir, name);
      if (existing) {
        const res = await fetchImpl(
          `${DRIVE_UPLOAD_API}/${existing}?uploadType=media`,
          {
            method: "PATCH",
            headers: { ...authHeader(), "Content-Type": mime },
            body: bytes,
          },
        );
        if (!res.ok) {
          const body = await readErrorBody(res);
          throw gdriveError("update", res.status, body, res.headers);
        }
        return;
      }
      const meta = JSON.stringify({ name, parents: [dirId] });
      const boundary = `notes-${randomBoundary()}`;
      // A Blob (not a string) so the raw image bytes survive the multipart
      // body untouched — a string body would be UTF-8 re-encoded and corrupt.
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
          `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
        bytes,
        `\r\n--${boundary}--`,
      ]);
      const res = await fetchImpl(`${DRIVE_UPLOAD_API}?uploadType=multipart`, {
        method: "POST",
        headers: {
          ...authHeader(),
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      });
      if (!res.ok) {
        const errBody = await readErrorBody(res);
        throw gdriveError("create", res.status, errBody, res.headers);
      }
    },

    async remove(path: string): Promise<void> {
      const { dir, name } = dirAndName(path);
      const fileId = await findFileId(dir, name);
      if (!fileId) return;
      const res = await fetchImpl(`${DRIVE_FILES_API}/${fileId}`, {
        method: "DELETE",
        headers: authHeader(),
      });
      if (!res.ok && res.status !== 404) {
        const body = await readErrorBody(res);
        throw gdriveError("delete", res.status, body, res.headers);
      }
    },
  };
}

// Delete a namespace's folder (and everything inside it) from Drive. Used
// when a namespace is removed while Google Drive is the active backend. The
// default namespace has no folder of its own — its files share the `notes/`
// app folder — so it is never passed here. A missing folder is a no-op.
export async function deleteGdriveNamespace(
  token: string,
  namespace: string,
  fetchImpl: FetchImpl = fetch,
): Promise<void> {
  const folderName = namespaceCloudFolder(namespace);
  if (!folderName) return;
  const auth = { Authorization: `Bearer ${token}` };

  async function searchOne(query: string): Promise<string | null> {
    const url = `${DRIVE_FILES_API}?q=${encodeURIComponent(
      query,
    )}&spaces=drive&fields=files(id)`;
    const res = await fetchImpl(url, { headers: auth });
    if (!res.ok) {
      const body = await readErrorBody(res);
      throw gdriveError("namespace delete (lookup)", res.status, body);
    }
    return ((await res.json()) as DriveListResponse).files?.[0]?.id ?? null;
  }

  const appId = await searchOne(
    `name='${GDRIVE_APP_FOLDER_NAME}' and mimeType='${FOLDER_MIME_TYPE}'` +
      ` and 'root' in parents and trashed=false`,
  );
  if (!appId) return;
  const nsId = await searchOne(
    `name='${folderName}' and mimeType='${FOLDER_MIME_TYPE}'` +
      ` and '${appId}' in parents and trashed=false`,
  );
  if (!nsId) return;
  const res = await fetchImpl(`${DRIVE_FILES_API}/${nsId}`, {
    method: "DELETE",
    headers: auth,
  });
  if (!res.ok && res.status !== 404) {
    const body = await readErrorBody(res);
    throw gdriveError("namespace delete", res.status, body, res.headers);
  }
}

function split(relDir: string): string[] {
  return relDir.split("/").filter((s) => s.length > 0);
}

function randomBoundary(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

// ---- OAuth (GIS token client) --------------------------------------

const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";

type GisTokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type GisTokenClientConfig = {
  client_id: string;
  scope: string;
  callback: (response: GisTokenResponse) => void;
  error_callback?: (err: GisErrorResponse) => void;
};

type GisTokenClient = {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
};

type GisErrorResponse = {
  type: string;
  message?: string;
};

type GisGlobal = {
  accounts: {
    oauth2: {
      initTokenClient(config: GisTokenClientConfig): GisTokenClient;
    };
  };
};

declare global {
  interface Window {
    google?: GisGlobal;
  }
}

let gisLoaderPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (typeof window !== "undefined" && window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  if (gisLoaderPromise) return gisLoaderPromise;
  log.info("loadGisScript: injecting <script>");
  gisLoaderPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.oauth2) {
        resolve();
      } else {
        gisLoaderPromise = null;
        reject(
          new Error(
            "Google sign-in loaded but didn't initialise. Reload the page and try again.",
          ),
        );
      }
    };
    script.onerror = () => {
      gisLoaderPromise = null;
      reject(
        new Error(
          "Couldn't reach Google to start sign-in. Check your connection (Wi-Fi, VPN, Private Relay, or content blocker) and try again.",
        ),
      );
    };
    document.head.appendChild(script);
  });
  return gisLoaderPromise;
}

// Kick off the GIS script load without blocking, so the eventual
// `requestAccessToken` runs synchronously inside the user gesture and the
// popup isn't blocked.
export function preloadGdriveAuth(): void {
  void loadGisScript().catch((err: unknown) => {
    log.warn(
      `preloadGdriveAuth: preload failed (will retry on click): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  });
}

// Opens the Google consent popup and resolves with a short-lived access
// token. Throws when the user dismisses the popup, the popup is blocked, or
// Google returns an error.
export async function startGdriveAuth(): Promise<string> {
  await loadGisScript();
  const gis = window.google?.accounts?.oauth2;
  if (!gis) {
    throw new Error("Google Identity Services unavailable after load");
  }
  return new Promise<string>((resolve, reject) => {
    const client = gis.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GDRIVE_SCOPE,
      callback: (resp) => {
        if (resp.error) {
          const desc = resp.error_description ?? resp.error;
          reject(new Error(`Google sign-in failed: ${desc}`));
          return;
        }
        if (!resp.access_token) {
          reject(new Error("Google did not return an access token"));
          return;
        }
        resolve(resp.access_token);
      },
      error_callback: (err) => {
        reject(
          new Error(err.message ?? `Google sign-in ${err.type ?? "failed"}`),
        );
      },
    });
    client.requestAccessToken();
  });
}
