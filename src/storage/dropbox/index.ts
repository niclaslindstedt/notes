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
import { createDirectoryAdapter } from "../directory-adapter.ts";
import type { FileEntry, FileStore } from "../file-store.ts";
import { fileSettingsStore, type SettingsStore } from "../settings-store.ts";
import { parseRetryAfterMs, readErrorBody } from "../http-utils.ts";
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
// as "Scoped access" with permission type "App folder" (folder name
// `notes.niclaslindstedt.se`). Its redirect URIs must include the prod and
// dev origins with no trailing slash — `startAuth` derives the URI from
// `window.location.origin` + pathname and Dropbox requires an exact match.
export const DROPBOX_APP_KEY = import.meta.env.VITE_DROPBOX_APP_KEY ?? "";

export function isDropboxConfigured(): boolean {
  return DROPBOX_APP_KEY.length > 0;
}

// Public folder name inside the user's Dropbox `Apps/` directory. This
// matches the Dropbox app registration's "App folder" name.
export const DROPBOX_APP_FOLDER = "notes.niclaslindstedt.se";

// Web URL that opens the app folder in Dropbox's web UI.
export function dropboxWebUrl(): string {
  return `https://www.dropbox.com/home/Apps/${DROPBOX_APP_FOLDER}`;
}

const TOKEN_ENDPOINT = "https://api.dropboxapi.com/oauth2/token";
const AUTH_BASE = "https://www.dropbox.com/oauth2/authorize";
const UPLOAD_ENDPOINT = "https://content.dropboxapi.com/2/files/upload";
const DOWNLOAD_ENDPOINT = "https://content.dropboxapi.com/2/files/download";
const LIST_FOLDER_ENDPOINT = "https://api.dropboxapi.com/2/files/list_folder";
const LIST_FOLDER_CONTINUE_ENDPOINT =
  "https://api.dropboxapi.com/2/files/list_folder/continue";
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

type DropboxEntry = {
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

export function createDropboxAdapter(
  auth: string | DropboxAuth,
  fetchImpl: FetchImpl = fetch,
): StorageAdapter {
  log.info("adapter created");
  const store = createDropboxFileStore(createAuthedFetch(auth, fetchImpl), "");
  return createDirectoryAdapter(store, {
    id: "dropbox",
    label: "Dropbox",
    saveDebounceMs: SAVE_DEBOUNCE_MS,
  });
}

// Settings store for the Dropbox backend: `/settings.json` at the app-folder
// root, beside the note markdown files.
export function createDropboxSettingsStore(
  auth: string | DropboxAuth,
  fetchImpl: FetchImpl = fetch,
): SettingsStore {
  return fileSettingsStore(
    createDropboxFileStore(createAuthedFetch(auth, fetchImpl), ""),
  );
}

type AuthedFetch = (
  url: string,
  build: (token: string) => RequestInit,
) => Promise<Response>;

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
): FileStore {
  const rootPrefix = `${rootPath}/`.toLowerCase();

  function relativePath(entry: DropboxEntry): string | null {
    const full = entry.path_display ?? entry.path_lower;
    if (!full) return null;
    if (full.toLowerCase().startsWith(rootPrefix)) {
      return full.slice(rootPrefix.length);
    }
    return null;
  }

  async function listOnce(
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

  return {
    async list(): Promise<FileEntry[]> {
      let page = await listOnce(LIST_FOLDER_ENDPOINT, {
        path: rootPath,
        recursive: true,
      });
      if (!page) return [];
      const out: FileEntry[] = [];
      for (;;) {
        for (const entry of page.entries) {
          if (entry[".tag"] !== "file") continue;
          const path = relativePath(entry);
          if (path) out.push({ path, rev: entry.rev });
        }
        if (!page.has_more) break;
        const next = await listOnce(LIST_FOLDER_CONTINUE_ENDPOINT, {
          cursor: page.cursor,
        });
        if (!next) break;
        page = next;
      }
      return out;
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

    async write(path: string, text: string): Promise<void> {
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
