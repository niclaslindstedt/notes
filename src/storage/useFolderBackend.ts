// The picked-folder (File System Access API) concern of the storage backend,
// extracted from `useStorageBackend` into a self-contained hook: the live
// directory handle and its boot-probe rehydration, the revoked-grant
// reconnect cue, and the connect / reconnect / disconnect verbs.
//
// Like the encryption seam — and unlike the namespace seam — this hook has a
// render-order cycle. It *produces* the `folderHandle` / `folderHandleLoaded`
// state and the `markFolderPermissionLost` callback that the backend selection
// (and therefore the document adapter) keys off, so it must run before that
// selection is resolved. But its connect / disconnect verbs need the active
// document adapter and namespace, which are built *from* that selection,
// afterwards. The cycle is broken by handing in an `activeRef` the verbs read
// at call time (the orchestrator populates it each render, once the adapter is
// built) — exactly the `innerRef` trick the encryption hook uses.

import { useCallback, useEffect, useState } from "react";

// Aliased: the orchestrator already imports the achievement `unlock`.
import { unlock as unlockAchievement } from "../achievements/index.ts";
import { createLogger } from "../dev/logger.ts";
import type { StorageAdapter } from "./adapter.ts";
import type { BackendId } from "./backend-preference.ts";
import type { DirectoryCrypto } from "./directory-adapter.ts";
import { createFolderAdapter } from "./folder/index.ts";
import {
  clearDirectoryHandle,
  ensurePermission,
  loadDirectoryHandle,
  saveDirectoryHandle,
} from "./folder/handle-store.ts";
import { getBackend } from "./backend-preference.ts";
import { BrowserLocalStorageAdapter } from "./local/index.ts";

const log = createLogger("storage");

export interface FolderBackend {
  /**
   * The picked local folder handle. `null` until the boot probe resolves, the
   * user picks one, or a revoked grant drops it.
   */
  folderHandle: FileSystemDirectoryHandle | null;
  /**
   * Gates the folder branch of the adapter selection until the boot probe has
   * run, so the orchestrator doesn't briefly build a folder adapter without a
   * handle.
   */
  folderHandleLoaded: boolean;
  /**
   * Set when the stored folder grant needs re-confirming (the OS revoked it
   * between sessions). The orchestrator falls back to the browser store until
   * the user clicks Reconnect.
   */
  folderReconnectNeeded: boolean;
  /**
   * Drop the live handle and surface the reconnect cue. Handed to the folder
   * adapter / settings / namespace stores so an in-flight read or write that
   * hits a revoked grant can fall back gracefully.
   */
  markFolderPermissionLost: () => void;
  /** Pick a folder, seed it from the current document, and switch to it. */
  connectFolder: () => Promise<void>;
  /** Re-confirm the OS grant on the already-picked folder. */
  reconnectFolder: () => Promise<void>;
  /** Mirror the folder back into the browser store, then forget the folder. */
  disconnectFolder: () => Promise<void>;
}

/**
 * The late-built dependencies the connect / disconnect verbs read at call
 * time. The active document `adapter` (the encryption-wrapped one — a folder
 * seed must read the *decrypted* current document) and the `activeNamespace`
 * are derived from the backend selection this hook feeds, so they arrive
 * through a ref the orchestrator assigns each render rather than as plain args.
 * `current` is null only on the first render pass, before any verb can fire.
 */
export interface FolderActiveRef {
  readonly current: {
    adapter: StorageAdapter;
    activeNamespace: string;
  } | null;
}

export interface FolderBackendDeps {
  activeRef: FolderActiveRef;
  /** The per-file crypto bundle the folder adapter seals with. */
  directoryCrypto: DirectoryCrypto;
  /**
   * Wrap a single-document adapter (the browser store) in the session's
   * whole-document encryption envelope, so the disconnect mirror writes the
   * same bytes the steady-state app does. A no-op when encryption is off.
   */
  wrapBrowserForActive: (raw: StorageAdapter) => StorageAdapter;
  /** Persist + activate a backend (the orchestrator's persist + setState). */
  selectBackend: (id: BackendId) => void;
}

export function useFolderBackend(deps: FolderBackendDeps): FolderBackend {
  const { activeRef, directoryCrypto, wrapBrowserForActive, selectBackend } =
    deps;

  const [folderHandle, setFolderHandle] =
    useState<FileSystemDirectoryHandle | null>(null);
  const [folderHandleLoaded, setFolderHandleLoaded] = useState<boolean>(
    () => getBackend() !== "folder",
  );
  const [folderReconnectNeeded, setFolderReconnectNeeded] = useState(false);

  // Drop the live handle and surface the reconnect cue. Called by the folder
  // adapter when an in-flight read / write hits a revoked grant; the IDB
  // record stays so Settings can re-grant in one click.
  const markFolderPermissionLost = useCallback(() => {
    log.warn("folder: permission lost during operation");
    setFolderHandle(null);
    setFolderReconnectNeeded(true);
  }, []);

  // Boot probe: when the saved backend is the folder, load the stored handle
  // from IndexedDB and ask the OS whether the grant still stands. Either
  // rehydrate the handle or fall back to the browser store with a reconnect
  // cue (the IDB record is kept so Reconnect can re-grant).
  useEffect(() => {
    if (getBackend() !== "folder") {
      setFolderHandleLoaded(true);
      return;
    }
    let cancelled = false;
    setFolderHandleLoaded(false);
    void (async () => {
      const stored = await loadDirectoryHandle();
      if (cancelled) return;
      if (!stored) {
        setFolderHandleLoaded(true);
        return;
      }
      const status = await ensurePermission(stored, false);
      if (cancelled) return;
      if (status === "granted") setFolderHandle(stored);
      else setFolderReconnectNeeded(true);
      setFolderHandleLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Pick a folder and switch to it. When the folder is empty, seed it with the
  // current document so the switch doesn't blank the screen; when it already
  // holds notes, adopt them (the folder wins). The handle is persisted to
  // IndexedDB so the grant survives reloads.
  const connectFolder = useCallback(async () => {
    if (typeof window === "undefined" || !window.showDirectoryPicker) return;
    const active = activeRef.current;
    if (!active) return;
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch (err) {
      // AbortError = the user dismissed the picker; nothing to do.
      if (err instanceof DOMException && err.name === "AbortError") return;
      log.error("folder picker failed", err);
      return;
    }
    const folder = createFolderAdapter({
      directoryHandle: handle,
      namespace: active.activeNamespace,
      crypto: directoryCrypto,
    });
    try {
      const [remote, source] = await Promise.all([
        folder.load().catch(() => null),
        active.adapter.load().catch(() => null),
      ]);
      if (!remote && source) await folder.save(source.text);
    } catch (err) {
      log.error("folder seed failed", err);
    }
    await saveDirectoryHandle(handle);
    setFolderHandle(handle);
    setFolderReconnectNeeded(false);
    setFolderHandleLoaded(true);
    selectBackend("folder");
    unlockAchievement("localVault");
  }, [activeRef, directoryCrypto, selectBackend]);

  // Re-confirm the OS grant on the already-stored handle. `requestPermission`
  // needs a user gesture, which is why this lives in a click handler.
  const reconnectFolder = useCallback(async () => {
    const stored = await loadDirectoryHandle();
    if (!stored) {
      await connectFolder();
      return;
    }
    const status = await ensurePermission(stored, true);
    if (status === "granted") {
      setFolderHandle(stored);
      setFolderReconnectNeeded(false);
    }
  }, [connectFolder]);

  // Mirror the folder's current document back into the browser store, then
  // forget the handle and switch back. Best-effort: a stale browser copy is a
  // few-edit regression at worst.
  const disconnectFolder = useCallback(async () => {
    const active = activeRef.current;
    if (folderHandle && active) {
      try {
        const folder = createFolderAdapter({
          directoryHandle: folderHandle,
          namespace: active.activeNamespace,
          crypto: directoryCrypto,
        });
        const snap = await folder.load();
        if (snap) {
          const browser = wrapBrowserForActive(
            new BrowserLocalStorageAdapter(
              globalThis.localStorage,
              active.activeNamespace,
            ),
          );
          await browser.save(snap.text);
        }
      } catch (err) {
        log.error("folder disconnect: mirror to browser failed", err);
      }
    }
    await clearDirectoryHandle();
    setFolderHandle(null);
    setFolderReconnectNeeded(false);
    selectBackend("browser");
  }, [
    activeRef,
    folderHandle,
    directoryCrypto,
    wrapBrowserForActive,
    selectBackend,
  ]);

  return {
    folderHandle,
    folderHandleLoaded,
    folderReconnectNeeded,
    markFolderPermissionLost,
    connectFolder,
    reconnectFolder,
    disconnectFolder,
  };
}
