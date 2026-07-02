// Dropbox-backed `StorageAdapter`. Talks to the v2 HTTP API directly (no SDK
// — a handful of endpoints don't justify ~100kB of bundle) and stores the
// notes as individual markdown files in the app's scoped folder
// (`/<slug>.md`), so the whole folder opens as plain notes in any editor and
// can be shared with another Dropbox account.
//
// The markdown <-> snapshot conversion, the encrypted-blob fallback, and
// conflict detection live in the shared directory adapter
// (`../directory-adapter.ts`); this module only implements the small
// `FileStore` that moves one file's bytes at a time, plus the OAuth /
// token-refresh machinery the cloud connection needs. Encryption still
// happens one level up in `withEncryption`, so an encrypted store lands as a
// single `/notes.json` envelope instead of markdown.

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
import { type AuthedFetch, listAllFiles } from "./list.ts";
import {
  type OAuthConfig,
  type TokenResult,
  completeAuth,
  refreshAccessToken,
  startAuth,
} from "../oauth-pkce.ts";

const log = createLogger("dropbox");

// Public app key. Dropbox's PKCE flow doesn't require a client secret, and
// the key itself is published in the deployed JS bundle either way — but it's
// read from a build-time env var so a fork can plug in its own Dropbox app.
// Set `VITE_DROPBOX_APP_KEY` in `.env.local` for dev and as a CI secret for
// the production build. Unset means the Dropbox backend is disabled in the
// picker.
//
// The matching app is registered at https://www.dropbox.com/developers/apps
// as "Scoped access" with permission type "App folder". Its redirect URIs
// must include the prod and dev origins with no trailing slash — `startAuth`
// derives the URI from `window.location.origin` + pathname and Dropbox
// requires an exact match.
export const DROPBOX_APP_KEY = import.meta.env.VITE_DROPBOX_APP_KEY ?? "";

export function isDropboxConfigured(): boolean {
  return DROPBOX_APP_KEY.length > 0;
}

// Public folder name inside the user's Dropbox `Apps/` directory. This must
// match the folder name on the Dropbox app registration's "App folder"
// permission — Dropbox creates `Apps/<this>/` on first connect. Read from a
// build-time env var (`VITE_DROPBOX_APP_FOLDER`) so a fork can point at its
// own app folder without editing source; defaults to the production app's
// `free-notes`.
export const DROPBOX_APP_FOLDER =
  import.meta.env.VITE_DROPBOX_APP_FOLDER ?? "free-notes";

// Web URL that opens the namespace's notes folder in Dropbox's web UI.
export function dropboxWebUrl(
  namespace: string = DEFAULT_NAMESPACE_SLUG,
): string {
  return `https://www.dropbox.com/home/Apps/${DROPBOX_APP_FOLDER}/${namespaceNotesFolder(
    namespace,
  )}`;
}

// The Dropbox path a namespace's whole folder lives under, relative to the
// app folder (empty for the default namespace, `/<slug>` otherwise). Used to
// delete a namespace wholesale; the note files themselves sit in the `notes/`
// subfolder of this (see `dropboxNotesPath`).
export function dropboxNamespacePath(namespace: string): string {
  const folder = namespaceCloudFolder(namespace);
  return folder ? `/${folder}` : "";
}

// The Dropbox path a namespace's note markdown files live under, relative to
// the app folder: `/notes` for the default namespace, `/<slug>/notes` for the
// rest. This is the root the document file store is scoped to.
export function dropboxNotesPath(namespace: string): string {
  return `/${namespaceNotesFolder(namespace)}`;
}

// The Dropbox path a namespace's image attachments live under, relative to the
// app folder: `/attachments` for the default namespace, `/<slug>/attachments`
// otherwise — a sibling of the notes folder. The root the attachment store is
// scoped to.
export function dropboxAttachmentsPath(namespace: string): string {
  return `/${namespaceAttachmentsFolder(namespace)}`;
}

const TOKEN_ENDPOINT = "https://api.dropboxapi.com/oauth2/token";
const AUTH_BASE = "https://www.dropbox.com/oauth2/authorize";
const UPLOAD_ENDPOINT = "https://content.dropboxapi.com/2/files/upload";
const DOWNLOAD_ENDPOINT = "https://content.dropboxapi.com/2/files/download";
const DELETE_ENDPOINT = "https://api.dropboxapi.com/2/files/delete_v2";

// 1-second coalescing window so cloud sync matches local-storage "save on
// every change" in feel — rapid edits within a single gesture collapse into
// one network save.
const SAVE_DEBOUNCE_MS = 1000;

// Floor for the cooldown after Dropbox returns 429.
const RATE_LIMIT_FALLBACK_MS = 5000;

// `sessionStorage` survives the OAuth redirect round-trip but is scoped to
// the tab, so a parallel auth flow in another tab can't race with this.
const PKCE_VERIFIER_KEY = "notes:dropbox:pkce:verifier";

export type FetchImpl = typeof fetch;

// Serialize an argument struct for the `Dropbox-API-Arg` header. ASCII-escape
// every character at or above U+0080 to its `\uXXXX` form — the browser's
// `fetch` refuses header values above U+00FF, and Dropbox decodes the escapes
// back to the original string.
export function dropboxApiArg(arg: unknown): string {
  return JSON.stringify(arg).replace(
    /[\u0080-\uffff]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

// Live access to the user's Dropbox tokens. The access token is short-lived
// (~4 hours), so the adapter holds a mutable copy and exchanges the refresh
// token for a fresh one on any 401 before retrying. `refreshToken` may be
// null for legacy connections authorized before refresh tokens were captured.
export type DropboxAuth = {
  accessToken: string;
  refreshToken: string | null;
  onAccessTokenRefreshed: (accessToken: string) => void;
};

export function createDropboxAdapter(
  auth: string | DropboxAuth,
  fetchImpl: FetchImpl = fetch,
  namespace: string = DEFAULT_NAMESPACE_SLUG,
  crypto?: DirectoryCrypto,
): StorageAdapter {
  log.info(`adapter created ns=${namespace}`);
  const authedFetch = createAuthedFetch(auth, fetchImpl);
  const store = createDropboxFileStore(
    authedFetch,
    dropboxNotesPath(namespace),
    true,
  );
  const attachments = createDropboxAttachmentStore(
    authedFetch,
    dropboxAttachmentsPath(namespace),
  );
  return createDirectoryAdapter(
    store,
    {
      id: "dropbox",
      label: "Dropbox",
      saveDebounceMs: SAVE_DEBOUNCE_MS,
    },
    attachments,
    crypto,
  );
}

// Settings store for the Dropbox backend: `/settings.json` at the app-folder
// root, beside the namespace folders. Built with an empty root path so the
// file store resolves at the app-folder root.
export function createDropboxSettingsStore(
  auth: string | DropboxAuth,
  fetchImpl: FetchImpl = fetch,
): SettingsStore {
  return fileSettingsStore(
    createDropboxFileStore(createAuthedFetch(auth, fetchImpl), ""),
  );
}

// Root namespace-registry store for the Dropbox backend: `/namespaces.json`
// at the app-folder root, beside `settings.json` and the namespace folders.
export function createDropboxNamespaceStore(
  auth: string | DropboxAuth,
  fetchImpl: FetchImpl = fetch,
): NamespaceRegistryStore {
  return fileNamespaceStore(
    createDropboxFileStore(createAuthedFetch(auth, fetchImpl), ""),
  );
}

// Build the bearer-token fetch the file store runs on: issue with the current
// access token, and on a 401 swap in a fresh one via the refresh token
// (coalescing concurrent refreshes) and retry exactly once before surfacing
// `AuthError`. Shared by the document adapter and the settings store so both
// ride the same silent-refresh path.
function createAuthedFetch(
  auth: string | DropboxAuth,
  fetchImpl: FetchImpl,
): AuthedFetch {
  let currentAccessToken: string;
  let refreshToken: string | null;
  let onAccessTokenRefreshed: ((token: string) => void) | null;
  if (typeof auth === "string") {
    currentAccessToken = auth;
    refreshToken = null;
    onAccessTokenRefreshed = null;
  } else {
    currentAccessToken = auth.accessToken;
    refreshToken = auth.refreshToken;
    onAccessTokenRefreshed = auth.onAccessTokenRefreshed;
  }

  // Coalesce in-flight refreshes so a concurrent burst doesn't trade the
  // refresh_token in twice.
  let pendingRefresh: Promise<string> | null = null;
  async function refreshOnce(): Promise<string | null> {
    if (!refreshToken) {
      log.warn("refresh skipped — no refresh token (legacy connection)");
      return null;
    }
    pendingRefresh ??= (async () => {
      try {
        const fresh = await refreshDropboxAccessToken(refreshToken!, fetchImpl);
        currentAccessToken = fresh;
        onAccessTokenRefreshed?.(fresh);
        return fresh;
      } finally {
        pendingRefresh = null;
      }
    })();
    try {
      return await pendingRefresh;
    } catch (err) {
      log.error("refresh failed", err);
      return null;
    }
  }

  return async function authedFetch(
    url: string,
    build: (token: string) => RequestInit,
  ): Promise<Response> {
    let res = await fetchImpl(url, build(currentAccessToken));
    if (res.status === 401) {
      log.info("401 — attempting silent refresh");
      const fresh = await refreshOnce();
      if (fresh) res = await fetchImpl(url, build(fresh));
    }
    if (res.status === 401) {
      const body = await readErrorBody(res);
      throw new AuthError(`Dropbox auth failed: 401 ${body}`);
    }
    return res;
  };
}

function createDropboxFileStore(
  authedFetch: AuthedFetch,
  rootPath: string,
  // The notes store descends into the folder subdirectories (a note filed into
  // a folder lives at `<folder-dir>/<stem>.md`); the shallow root settings /
  // registry stores never call `list`.
  recursive: boolean = false,
): FileStore {
  const rootPrefix = `${rootPath}/`.toLowerCase();

  return {
    async list(): Promise<FileEntry[]> {
      // The notes store lists recursively so a note filed into a folder
      // (`<folder-dir>/<stem>.md`) is found; the folder subdirectories live
      // inside the namespace's `notes/` root, so descending stays scoped to
      // this namespace and never reaches another's sibling folder. When
      // shallow, a relative path with a slash sits inside a subfolder — skip
      // it. When recursive, those nested note files are the point.
      return listAllFiles(
        authedFetch,
        rootPath,
        recursive,
        rootPrefix,
        (entry, path) =>
          recursive || !path.includes("/") ? { path, rev: entry.rev } : null,
      );
    },

    async read(path: string): Promise<string | null> {
      const res = await authedFetch(DOWNLOAD_ENDPOINT, (token) => ({
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Dropbox-API-Arg": dropboxApiArg({ path: `${rootPath}/${path}` }),
        },
      }));
      if (res.status === 409) return null;
      if (!res.ok) {
        const detail = await readErrorBody(res);
        throw new Error(`Dropbox download failed: ${res.status} ${detail}`);
      }
      return res.text();
    },

    async write(path: string, text: string): Promise<string | undefined> {
      const res = await authedFetch(UPLOAD_ENDPOINT, (token) => ({
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Dropbox-API-Arg": dropboxApiArg({
            path: `${rootPath}/${path}`,
            mode: "overwrite",
            mute: true,
          }),
          "Content-Type": "application/octet-stream",
        },
        body: text,
      }));
      if (res.status === 429) {
        throw new RateLimitError(
          parseRetryAfterMs(res.headers, RATE_LIMIT_FALLBACK_MS),
        );
      }
      if (!res.ok) {
        const detail = await readErrorBody(res);
        throw new Error(`Dropbox upload failed: ${res.status} ${detail}`);
      }
      // The upload response is the file's new metadata; its `rev` is exactly
      // what `list()` reports for these bytes, so the directory adapter can
      // stamp the post-save revision without an eventually-consistent re-list.
      const meta = (await res.json()) as { rev?: string };
      if (typeof meta.rev !== "string") {
        log.warn(`upload ${path}: response carried no rev`, meta);
      } else {
        log.info(`upload ${path}: rev=${meta.rev}`);
      }
      return meta.rev;
    },

    async remove(path: string): Promise<void> {
      const res = await authedFetch(DELETE_ENDPOINT, (token) => ({
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: `${rootPath}/${path}` }),
      }));
      if (res.status === 409) return; // already gone
      if (!res.ok) {
        const detail = await readErrorBody(res);
        throw new Error(`Dropbox delete failed: ${res.status} ${detail}`);
      }
    },
  };
}

// Binary attachment store for Dropbox: a note's images under
// `/attachments/<note-name>/` (or `/<slug>/attachments/...`). Lists
// recursively (the tree is nested, unlike the flat notes folder), moves raw
// image bytes, and rides the same authed-fetch / silent-refresh path.
function createDropboxAttachmentStore(
  authedFetch: AuthedFetch,
  rootPath: string,
): AttachmentStore {
  const rootPrefix = `${rootPath}/`.toLowerCase();

  return {
    async list(): Promise<AttachmentEntry[]> {
      // Recursive: the attachments tree nests one note-name folder deep, so
      // unlike the flat notes folder it must be walked in full. Only the
      // nested files (a relative path with a slash) are attachments.
      return listAllFiles(
        authedFetch,
        rootPath,
        true,
        rootPrefix,
        (_entry, path) => (path.includes("/") ? { path } : null),
      );
    },

    async read(path: string): Promise<Uint8Array | null> {
      const res = await authedFetch(DOWNLOAD_ENDPOINT, (token) => ({
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Dropbox-API-Arg": dropboxApiArg({ path: `${rootPath}/${path}` }),
        },
      }));
      if (res.status === 409) return null;
      if (!res.ok) {
        const detail = await readErrorBody(res);
        throw new Error(`Dropbox download failed: ${res.status} ${detail}`);
      }
      return new Uint8Array(await res.arrayBuffer());
    },

    async write(path: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
      const res = await authedFetch(UPLOAD_ENDPOINT, (token) => ({
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Dropbox-API-Arg": dropboxApiArg({
            path: `${rootPath}/${path}`,
            mode: "overwrite",
            mute: true,
          }),
          "Content-Type": "application/octet-stream",
        },
        body: bytes,
      }));
      if (res.status === 429) {
        throw new RateLimitError(
          parseRetryAfterMs(res.headers, RATE_LIMIT_FALLBACK_MS),
        );
      }
      if (!res.ok) {
        const detail = await readErrorBody(res);
        throw new Error(`Dropbox upload failed: ${res.status} ${detail}`);
      }
    },

    async remove(path: string): Promise<void> {
      const res = await authedFetch(DELETE_ENDPOINT, (token) => ({
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: `${rootPath}/${path}` }),
      }));
      if (res.status === 409) return; // already gone
      if (!res.ok) {
        const detail = await readErrorBody(res);
        throw new Error(`Dropbox delete failed: ${res.status} ${detail}`);
      }
    },
  };
}

// Delete a namespace's entire folder (`/<slug>`) from Dropbox. Used when a
// namespace is removed while Dropbox is the active backend. A 409 (already
// gone) is treated as success. The default namespace has no folder of its
// own — its files share the app-folder root — so it is never passed here.
export async function deleteDropboxNamespace(
  auth: string | DropboxAuth,
  namespace: string,
  fetchImpl: FetchImpl = fetch,
): Promise<void> {
  const path = dropboxNamespacePath(namespace);
  if (!path) return;
  const authedFetch = createAuthedFetch(auth, fetchImpl);
  const res = await authedFetch(DELETE_ENDPOINT, (token) => ({
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path }),
  }));
  if (res.status === 409) return; // already gone
  if (!res.ok) {
    const detail = await readErrorBody(res);
    throw new Error(`Dropbox namespace delete failed: ${res.status} ${detail}`);
  }
}

// ---- OAuth (PKCE) ---------------------------------------------------

const DROPBOX_OAUTH: OAuthConfig = {
  authBase: AUTH_BASE,
  tokenEndpoint: TOKEN_ENDPOINT,
  clientId: DROPBOX_APP_KEY,
  state: "dropbox",
  verifierKey: PKCE_VERIFIER_KEY,
  providerName: "Dropbox",
  extraAuthParams: { token_access_type: "offline" },
};

export type DropboxAuthResult = TokenResult;

export function startDropboxAuth(): Promise<void> {
  return startAuth(DROPBOX_OAUTH);
}

// True when a Dropbox OAuth flow is mid-flight — i.e. `startDropboxAuth`
// stashed a PKCE verifier in `sessionStorage` and the redirect back from
// Dropbox has not yet been consumed by `completeDropboxAuth`.
export function hasPendingDropboxAuth(): boolean {
  return sessionStorage.getItem(PKCE_VERIFIER_KEY) !== null;
}

export function completeDropboxAuth(
  code: string,
  fetchImpl: FetchImpl = fetch,
): Promise<DropboxAuthResult> {
  return completeAuth(DROPBOX_OAUTH, code, fetchImpl);
}

export function refreshDropboxAccessToken(
  refreshToken: string,
  fetchImpl: FetchImpl = fetch,
): Promise<string> {
  return refreshAccessToken(DROPBOX_OAUTH, refreshToken, fetchImpl);
}
