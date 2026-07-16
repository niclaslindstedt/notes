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
import type { StorageAdapter } from "../adapter.ts";
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
import {
  fileConfigPlaneStore,
  type ConfigPlaneStore,
} from "../notesd/config-plane.ts";
import { readErrorBody } from "../http-utils.ts";
import {
  DRIVE_FILES_API,
  DRIVE_UPLOAD_API,
  type DriveFile,
  type DriveListResponse,
  FOLDER_MIME_TYPE,
  GDRIVE_APP_FOLDER_NAME,
  type FetchImpl,
  childFileQuery,
  createDriveFolderFs,
  dirAndName,
  gdriveError,
} from "./drive-fs.ts";

export { GDRIVE_APP_FOLDER_NAME, type FetchImpl } from "./drive-fs.ts";

const log = createLogger("gdrive");

// Public OAuth client id, read from a build-time env var so a fork can plug
// in its own Google Cloud project. Unset means the Google Drive backend is
// disabled in the picker.
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

export function isGdriveConfigured(): boolean {
  return GOOGLE_CLIENT_ID.length > 0;
}

// `drive.file` lets the app see and manage only files it created. Files stay
// visible to the user in Drive's UI.
export const GDRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const SAVE_DEBOUNCE_MS = 1000;

// Returns a URL that opens Drive's web UI (the app folder, or My Drive when
// the folder id isn't known here).
export function gdriveWebUrl(folderId: string | null): string {
  return folderId
    ? `https://drive.google.com/drive/folders/${folderId}`
    : "https://drive.google.com/drive/my-drive";
}

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
    true,
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

// notesd config-plane store for the Google Drive backend: `notesd.json` in the
// `notes/` app folder, beside `settings.json` — the paired-daemon discovery
// list (see `notesd/config-plane.ts`).
export function createGdriveConfigPlaneStore(
  token: string,
  fetchImpl: FetchImpl = fetch,
): ConfigPlaneStore {
  return fileConfigPlaneStore(createGdriveFileStore(token, fetchImpl, ""));
}

function createGdriveFileStore(
  token: string,
  fetchImpl: FetchImpl,
  baseFolder: string = "",
  // The notes store descends into the folder subdirectories (a note filed into
  // a folder lives at `<folder-dir>/<stem>.md`); the shallow root settings /
  // registry stores never call `list`.
  recursive: boolean = false,
): FileStore {
  const drive = createDriveFolderFs(token, fetchImpl, baseFolder);

  // List the files under a directory. The notes store descends into the folder
  // subdirectories (a note filed into a folder lives at `<folder-dir>/<stem>.md`),
  // building `/`-joined relative paths; the shallow root stores skip folders.
  // The folder subdirectories live inside the namespace's `notes/` app folder,
  // so descending stays scoped to this namespace.
  async function listDir(
    dirId: string,
    prefix: string,
    out: FileEntry[],
  ): Promise<void> {
    const files = await drive.search(
      `'${dirId}' in parents and trashed=false`,
      "id,name,mimeType,version",
      "list",
    );
    for (const file of files) {
      const name = file.name ?? "";
      const path = prefix ? `${prefix}/${name}` : name;
      if (file.mimeType === FOLDER_MIME_TYPE) {
        if (recursive && file.id) await listDir(file.id, path, out);
        continue;
      }
      out.push({ path, rev: file.version });
    }
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
          ...drive.authHeader(),
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
      const baseId = await drive.resolveDirId("", false);
      if (!baseId) return [];
      const out: FileEntry[] = [];
      await listDir(baseId, "", out);
      return out;
    },

    async read(path: string): Promise<string | null> {
      const { dir, name } = dirAndName(path);
      const fileId = await drive.findFileId(dir, name);
      if (!fileId) return null;
      const res = await fetchImpl(`${DRIVE_FILES_API}/${fileId}?alt=media`, {
        headers: drive.authHeader(),
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
      const dirId = await drive.resolveDirId(dir, true);
      if (!dirId) throw new Error(`Google Drive: cannot resolve ${dir}`);
      const existing = await drive.searchOneId(childFileQuery(name, dirId));
      if (existing) {
        const res = await fetchImpl(
          `${DRIVE_UPLOAD_API}/${existing}?uploadType=media&fields=version`,
          {
            method: "PATCH",
            headers: { ...drive.authHeader(), "Content-Type": "text/markdown" },
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
      const { dir, name } = dirAndName(path);
      const fileId = await drive.findFileId(dir, name);
      if (!fileId) return;
      const res = await fetchImpl(`${DRIVE_FILES_API}/${fileId}`, {
        method: "DELETE",
        headers: drive.authHeader(),
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
  const drive = createDriveFolderFs(token, fetchImpl, baseFolder);
  const { authHeader, search, resolveDirId, findFileId } = drive;

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
