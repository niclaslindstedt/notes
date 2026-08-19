// The backend-resolution concern of the storage orchestrator, lifted out of
// `useStorageBackend`: resolve the active backend once from the per-device
// preference plus the live tokens / folder grant, and expose the adapter
// factory both the active-document adapter and the cross-namespace move verbs
// build from.
//
// Kept as a leaf hook fed plain arguments: it reads the cloud tokens
// (`useCloudBackend`), the folder handle (`useFolderBackend`), and the
// per-namespace crypto / cache seal-unseal (`useEncryption`) the orchestrator has
// already produced, and returns `selection` + `makeInner`. `makeInner` takes
// the namespace as an argument (not a closed-over active one) so a move can
// spin up an adapter for any namespace's storage location without switching to
// it.

import { useCallback, useMemo } from "react";

import { createPinnedFetch } from "../platform/native-bridge.ts";
import type { StorageAdapter } from "./adapter.ts";
import type { BackendId, NotesdConfig } from "./backend-preference.ts";
import type { DirectoryCrypto } from "./directory-adapter.ts";
import type { DropboxAuth } from "./dropbox/index.ts";
import { BrowserLocalStorageAdapter } from "./local/index.ts";
import type { RemoteBackends } from "./remote-backends.ts";

// The resolved active backend, computed once per change so the document
// adapter and the root settings / namespace stores are built from the same
// branch instead of re-deriving the `backend && token` chain several times.
export type BackendSelection =
  | { kind: "dropbox"; auth: DropboxAuth }
  | { kind: "gdrive"; token: string }
  | { kind: "folder"; handle: FileSystemDirectoryHandle }
  | { kind: "notesd"; config: NotesdConfig }
  | { kind: "browser" };

export interface BackendSelectionDeps {
  /** The per-device backend preference. */
  backend: BackendId;
  /**
   * The lazily-loaded remote-backend family, or null while it is still in
   * flight. Every non-browser arm below requires it, so a null keeps the
   * selection on the browser store — the same fall-through an unresolved
   * token or folder grant already takes. See `useRemoteBackends`.
   */
  remote: RemoteBackends | null;
  /** The cloud tokens, null until each backend is connected. */
  dropboxToken: string | null;
  dropboxRefresh: string | null;
  gdriveToken: string | null;
  /** Persist a silently-refreshed Dropbox access token back to storage. */
  rememberDropboxAccessToken: (accessToken: string) => void;
  /** The paired notesd daemon config, null until a daemon is paired. */
  notesdConfig: NotesdConfig | null;
  /** The picked folder handle + whether the boot probe has resolved it. */
  folderHandle: FileSystemDirectoryHandle | null;
  folderHandleLoaded: boolean;
  /** Called when a folder op hits a revoked OS grant, to drop to the browser. */
  markFolderPermissionLost: () => void;
  /**
   * The at-rest crypto one namespace's directory adapter reads at call time.
   * Keyed by namespace because encryption is a per-namespace decision — see
   * `useEncryption`.
   */
  cryptoFor: (namespace: string) => DirectoryCrypto;
  /** Seal / unseal a namespace's cloud offline-cache envelope. */
  sealFor: (namespace: string) => (plaintext: string) => Promise<string>;
  unsealFor: (namespace: string) => (stored: string) => Promise<string>;
}

export interface BackendSelectionResult {
  /** The resolved active backend. */
  selection: BackendSelection;
  /**
   * Build the unwrapped backend adapter for *any* namespace on the current
   * selection. Cloud adapters get fresh tokens on every change so a reconnect
   * rebuilds them; the Dropbox adapter persists any silently refreshed access
   * token back via the selection's `onAccessTokenRefreshed`.
   */
  makeInner: (namespace: string) => StorageAdapter;
}

export function useBackendSelection(
  deps: BackendSelectionDeps,
): BackendSelectionResult {
  const {
    backend,
    remote,
    dropboxToken,
    dropboxRefresh,
    gdriveToken,
    rememberDropboxAccessToken,
    notesdConfig,
    folderHandle,
    folderHandleLoaded,
    markFolderPermissionLost,
    cryptoFor,
    sealFor,
    unsealFor,
  } = deps;

  // Resolve the active backend once. Both builders below switch on this
  // single selection rather than re-deriving the `backend && token` chain.
  const selection = useMemo<BackendSelection>(() => {
    // `remote` gates every arm below: until the family has loaded there is no
    // factory to build the adapter with, so the selection stays on the browser
    // store exactly as it does while a token or grant is still resolving.
    if (!remote) return { kind: "browser" };
    if (backend === "dropbox" && dropboxToken) {
      return {
        kind: "dropbox",
        auth: {
          accessToken: dropboxToken,
          refreshToken: dropboxRefresh,
          onAccessTokenRefreshed: rememberDropboxAccessToken,
        },
      };
    }
    if (backend === "gdrive" && gdriveToken) {
      return { kind: "gdrive", token: gdriveToken };
    }
    if (backend === "notesd" && notesdConfig) {
      return { kind: "notesd", config: notesdConfig };
    }
    // Folder backend: only once the boot probe has resolved with a live,
    // permission-granted handle. While probing, or after a revoked grant,
    // fall through to the browser store so editing keeps working.
    if (backend === "folder" && folderHandleLoaded && folderHandle) {
      return { kind: "folder", handle: folderHandle };
    }
    return { kind: "browser" };
  }, [
    backend,
    remote,
    dropboxToken,
    dropboxRefresh,
    gdriveToken,
    rememberDropboxAccessToken,
    notesdConfig,
    folderHandle,
    folderHandleLoaded,
  ]);

  const makeInner = useCallback(
    (namespace: string): StorageAdapter => {
      // Unreachable without `remote` — `selection` can only leave "browser"
      // once it has loaded — but narrow it for the type checker all the same.
      if (!remote || selection.kind === "browser") {
        return new BrowserLocalStorageAdapter(
          globalThis.localStorage,
          namespace,
        );
      }
      switch (selection.kind) {
        // Cloud backends mirror their bytes into a local cache so the document
        // can be unlocked, read, and edited offline (the cache holds the
        // encrypted envelope when encryption is on). Folder / browser are
        // already on-device, so they need no mirror.
        case "dropbox":
          return remote.withLocalCache(
            remote.createDropboxAdapter(
              selection.auth,
              fetch,
              namespace,
              cryptoFor(namespace),
            ),
            {
              storage: globalThis.localStorage,
              key: remote.localCacheKey("dropbox", namespace),
              seal: sealFor(namespace),
              unseal: unsealFor(namespace),
            },
          );
        case "gdrive":
          return remote.withLocalCache(
            remote.createGdriveAdapter(
              selection.token,
              fetch,
              namespace,
              cryptoFor(namespace),
            ),
            {
              storage: globalThis.localStorage,
              key: remote.localCacheKey("gdrive", namespace),
              seal: sealFor(namespace),
              unseal: unsealFor(namespace),
            },
          );
        case "folder":
          return remote.createFolderAdapter({
            directoryHandle: selection.handle,
            namespace,
            onPermissionLost: markFolderPermissionLost,
            crypto: cryptoFor(namespace),
          });
        // notesd is a directory backend over an SPKI-pinned fetch: each
        // namespace's notes and attachments live as individual files in their
        // own `notes/` / `attachments/` subfolder, and encryption composes per
        // file *inside* the directory adapter via `directoryCrypto` — exactly
        // like the folder backend (which, being on-device, likewise needs no
        // offline-cache mirror).
        case "notesd":
          return remote.createNotesdAdapter(
            selection.config,
            createPinnedFetch(selection.config.spkiPin),
            namespace,
            cryptoFor(namespace),
          );
      }
    },
    [
      selection,
      remote,
      markFolderPermissionLost,
      cryptoFor,
      sealFor,
      unsealFor,
    ],
  );

  return { selection, makeInner };
}
