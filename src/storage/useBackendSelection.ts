// The backend-resolution concern of the storage orchestrator, lifted out of
// `useStorageBackend`: resolve the active backend once from the per-device
// preference plus the live tokens / folder grant, and expose the adapter
// factory both the active-document adapter and the cross-namespace move verbs
// build from.
//
// Kept as a leaf hook fed plain arguments: it reads the cloud tokens
// (`useCloudBackend`), the folder handle (`useFolderBackend`), and the
// encryption crypto / cache seal-unseal (`useEncryption`) the orchestrator has
// already produced, and returns `selection` + `makeInner`. `makeInner` takes
// the namespace as an argument (not a closed-over active one) so a move can
// spin up an adapter for any namespace's storage location without switching to
// it.

import { useCallback, useMemo } from "react";

import type { StorageAdapter } from "./adapter.ts";
import type { BackendId } from "./backend-preference.ts";
import { localCacheKey, withLocalCache } from "./cache/index.ts";
import type { DirectoryCrypto } from "./directory-adapter.ts";
import { type DropboxAuth, createDropboxAdapter } from "./dropbox/index.ts";
import { createGdriveAdapter } from "./gdrive/index.ts";
import { createFolderAdapter } from "./folder/index.ts";
import { BrowserLocalStorageAdapter } from "./local/index.ts";

// The resolved active backend, computed once per change so the document
// adapter and the root settings / namespace stores are built from the same
// branch instead of re-deriving the `backend && token` chain several times.
export type BackendSelection =
  | { kind: "dropbox"; auth: DropboxAuth }
  | { kind: "gdrive"; token: string }
  | { kind: "folder"; handle: FileSystemDirectoryHandle }
  | { kind: "browser" };

export interface BackendSelectionDeps {
  /** The per-device backend preference. */
  backend: BackendId;
  /** The cloud tokens, null until each backend is connected. */
  dropboxToken: string | null;
  dropboxRefresh: string | null;
  gdriveToken: string | null;
  /** Persist a silently-refreshed Dropbox access token back to storage. */
  rememberDropboxAccessToken: (accessToken: string) => void;
  /** The picked folder handle + whether the boot probe has resolved it. */
  folderHandle: FileSystemDirectoryHandle | null;
  folderHandleLoaded: boolean;
  /** Called when a folder op hits a revoked OS grant, to drop to the browser. */
  markFolderPermissionLost: () => void;
  /** The at-rest crypto the directory adapters read at call time. */
  directoryCrypto: DirectoryCrypto;
  /** Seal / unseal the cloud backends' offline cache envelope. */
  seal: (plaintext: string) => Promise<string>;
  unseal: (stored: string) => Promise<string>;
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
    dropboxToken,
    dropboxRefresh,
    gdriveToken,
    rememberDropboxAccessToken,
    folderHandle,
    folderHandleLoaded,
    markFolderPermissionLost,
    directoryCrypto,
    seal,
    unseal,
  } = deps;

  // Resolve the active backend once. Both builders below switch on this
  // single selection rather than re-deriving the `backend && token` chain.
  const selection = useMemo<BackendSelection>(() => {
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
    // Folder backend: only once the boot probe has resolved with a live,
    // permission-granted handle. While probing, or after a revoked grant,
    // fall through to the browser store so editing keeps working.
    if (backend === "folder" && folderHandleLoaded && folderHandle) {
      return { kind: "folder", handle: folderHandle };
    }
    return { kind: "browser" };
  }, [
    backend,
    dropboxToken,
    dropboxRefresh,
    gdriveToken,
    rememberDropboxAccessToken,
    folderHandle,
    folderHandleLoaded,
  ]);

  const makeInner = useCallback(
    (namespace: string): StorageAdapter => {
      switch (selection.kind) {
        // Cloud backends mirror their bytes into a local cache so the document
        // can be unlocked, read, and edited offline (the cache holds the
        // encrypted envelope when encryption is on). Folder / browser are
        // already on-device, so they need no mirror.
        case "dropbox":
          return withLocalCache(
            createDropboxAdapter(
              selection.auth,
              fetch,
              namespace,
              directoryCrypto,
            ),
            {
              storage: globalThis.localStorage,
              key: localCacheKey("dropbox", namespace),
              seal,
              unseal,
            },
          );
        case "gdrive":
          return withLocalCache(
            createGdriveAdapter(
              selection.token,
              fetch,
              namespace,
              directoryCrypto,
            ),
            {
              storage: globalThis.localStorage,
              key: localCacheKey("gdrive", namespace),
              seal,
              unseal,
            },
          );
        case "folder":
          return createFolderAdapter({
            directoryHandle: selection.handle,
            namespace,
            onPermissionLost: markFolderPermissionLost,
            crypto: directoryCrypto,
          });
        case "browser":
          return new BrowserLocalStorageAdapter(
            globalThis.localStorage,
            namespace,
          );
      }
    },
    [selection, markFolderPermissionLost, directoryCrypto, seal, unseal],
  );

  return { selection, makeInner };
}
