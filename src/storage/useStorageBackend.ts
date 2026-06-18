// Top-level storage wiring, as a hook. Selects the active `StorageAdapter`
// from the per-device backend preference, holds the cloud access tokens,
// completes the OAuth redirect on boot, and layers optional at-rest
// encryption on top. Collapsed to fit an account-less, single-document app.
//
// Encryption note: there are no user accounts, so the encryption passphrase
// isn't derived from a login — it's set explicitly in Settings and held only
// in memory for the session. After a reload the app is "locked" (encryption
// is on but no passphrase is held) until the user re-enters it; the `locked`
// flag drives the unlock gate in `App`.

import { useCallback, useEffect, useMemo, useState } from "react";

// Aliased: this module already has a passphrase `unlock` of its own.
import { unlock as unlockAchievement } from "../achievements/index.ts";
import { createLogger } from "../dev/logger.ts";
import type { StorageAdapter, StoredSnapshot } from "./adapter.ts";
import {
  type BackendId,
  type EncryptionMode,
  clearDropboxRefreshToken,
  clearDropboxToken,
  clearGdriveToken,
  getBackend,
  getDropboxRefreshToken,
  getDropboxToken,
  getEncryption,
  getGdriveToken,
  setBackend as persistBackend,
  setDropboxRefreshToken,
  setDropboxToken,
  setEncryption as persistEncryption,
  setGdriveToken,
} from "./backend-preference.ts";
import {
  OfflineUnavailableError,
  localCacheKey,
  withLocalCache,
} from "./cache/index.ts";
import { decryptEnvelope, encryptText, isEncryptedEnvelope } from "./crypto.ts";
import {
  type DropboxAuth,
  completeDropboxAuth,
  createDropboxAdapter,
  createDropboxNamespaceStore,
  createDropboxSettingsStore,
  deleteDropboxNamespace,
  hasPendingDropboxAuth,
  isDropboxConfigured,
  startDropboxAuth,
} from "./dropbox/index.ts";
import { withEncryption } from "./encrypting/index.ts";
import {
  createGdriveAdapter,
  createGdriveNamespaceStore,
  createGdriveSettingsStore,
  deleteGdriveNamespace,
  isGdriveConfigured,
  startGdriveAuth,
} from "./gdrive/index.ts";
import {
  BrowserLocalStorageAdapter,
  deleteLocalNamespace,
} from "./local/index.ts";
import {
  createFolderAdapter,
  createFolderNamespaceStore,
  createFolderSettingsStore,
} from "./folder/index.ts";
import type { NamespaceRegistryStore } from "./namespace-store.ts";
import {
  type Namespace,
  type NamespaceAppearance,
  DEFAULT_NAMESPACE_SLUG,
  addNamespace as registryAddNamespace,
  getActiveNamespaceSlug,
  getNamespaces,
  hasLocalOnlyNamespaces,
  mergeNamespaceLists,
  parseNamespaces,
  removeNamespace as registryRemoveNamespace,
  renameNamespace as registryRenameNamespace,
  serializeNamespaces,
  setActiveNamespaceSlug,
  setNamespaceAppearance as registrySetNamespaceAppearance,
  setNamespaces as registrySetNamespaces,
} from "./namespaces.ts";
import type { SettingsStore } from "./settings-store.ts";
import {
  clearDirectoryHandle,
  ensurePermission,
  isFolderBackendAvailable,
  loadDirectoryHandle,
  saveDirectoryHandle,
} from "./folder/handle-store.ts";

const log = createLogger("storage");

export interface UseStorageBackend {
  /** The adapter to hand to the sync engine. A no-op placeholder while locked. */
  adapter: StorageAdapter;
  /**
   * The active backend's root settings store — `settings.json` at the
   * app-folder root, stored as plaintext JSON even when the notes are
   * encrypted. Null for the browser backend (which keeps settings in
   * localStorage) and while a folder grant is unresolved; the appearance
   * store reconciles against it when present.
   */
  settingsStore: SettingsStore | null;
  /** Which backend is selected. */
  backend: BackendId;
  /** Whether each cloud backend's app key / client id is built in. */
  dropboxConfigured: boolean;
  gdriveConfigured: boolean;
  /** Whether each cloud backend currently holds a usable token. */
  dropboxConnected: boolean;
  gdriveConnected: boolean;
  /** Whether this browser exposes the File System Access directory picker. */
  folderAvailable: boolean;
  /** Whether a picked folder is connected and usable right now. */
  folderConnected: boolean;
  /**
   * Set when the stored folder grant needs re-confirming (the OS revoked it
   * between sessions). The folder backend falls back to the browser store
   * until the user clicks Reconnect.
   */
  folderReconnectNeeded: boolean;
  /** Encryption mode and whether a passphrase is held this session. */
  encryption: EncryptionMode;
  /** True when encryption is on but no passphrase is held yet (needs unlock). */
  locked: boolean;
  selectBrowser: () => void;
  /** Pick a folder, seed it from the current document, and switch to it. */
  connectFolder: () => Promise<void>;
  /** Re-confirm the OS grant on the already-picked folder. */
  reconnectFolder: () => Promise<void>;
  /** Mirror the folder back into the browser store, then forget the folder. */
  disconnectFolder: () => Promise<void>;
  connectDropbox: () => void;
  disconnectDropbox: () => void;
  connectGdrive: () => Promise<void>;
  disconnectGdrive: () => void;
  /** Turn encryption on with a fresh passphrase, re-wrapping stored bytes. */
  enableEncryption: (password: string) => Promise<void>;
  /** Turn encryption off, decrypting stored bytes back to plaintext. */
  disableEncryption: () => Promise<void>;
  /** Supply the passphrase for an already-encrypted store; throws if wrong. */
  unlock: (password: string) => Promise<void>;
  /** Namespaces known on this device (default always first). */
  namespaces: Namespace[];
  /** The active namespace's slug. */
  activeNamespace: string;
  /** Make a namespace active, swapping which document the app reads/writes. */
  switchNamespace: (slug: string) => void;
  /** Create a namespace from a display name and switch to it. */
  createNamespace: (name: string, appearance?: NamespaceAppearance) => void;
  /** Change a namespace's display name (its data stays put). */
  renameNamespace: (slug: string, name: string) => void;
  /**
   * Set or clear a namespace's appearance (its icon and/or accent colour).
   * Applies live — there is no draft/Save step.
   */
  setNamespaceAppearance: (slug: string, patch: NamespaceAppearance) => void;
  /**
   * Remove a namespace and delete its data in the *active* backend. The
   * default namespace can't be removed. Orphaned copies in other backends
   * are left for the user to clean up.
   */
  removeNamespace: (slug: string) => Promise<void>;
}

// Strip the OAuth redirect's query params (`code`, `state`, `scope`) from the
// address bar without reloading, so a refresh doesn't replay a spent
// authorization code.
function cleanAuthParamsFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    let touched = false;
    for (const key of ["code", "state", "scope"]) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        touched = true;
      }
    }
    if (touched) {
      window.history.replaceState(null, "", url.toString());
    }
  } catch (err) {
    log.warn("failed to clean auth params from URL", err);
  }
}

// Placeholder used while the store is locked: never touches the real backend,
// so the encrypted bytes stay sealed and an accidental edit behind the unlock
// gate can't overwrite them. Resolves saves to a no-op rather than rejecting
// so no stray promise rejection surfaces.
function lockedAdapter(id: BackendId): StorageAdapter {
  return {
    id,
    label: "Locked",
    capabilities: new Set(),
    async load(): Promise<StoredSnapshot | null> {
      return null;
    },
    async save(text: string): Promise<StoredSnapshot> {
      log.warn("save ignored — store is locked");
      return { text };
    },
  };
}

// The resolved active backend, computed once per change so the document
// adapter and the root settings store are built from the same branch instead
// of re-deriving the `backend && token` chain twice.
type BackendSelection =
  | { kind: "dropbox"; auth: DropboxAuth }
  | { kind: "gdrive"; token: string }
  | { kind: "folder"; handle: FileSystemDirectoryHandle }
  | { kind: "browser" };

export function useStorageBackend(): UseStorageBackend {
  const [backend, setBackendState] = useState<BackendId>(getBackend);
  const [dropboxToken, setDropboxTokenState] = useState<string | null>(
    getDropboxToken,
  );
  const [dropboxRefresh, setDropboxRefreshState] = useState<string | null>(
    getDropboxRefreshToken,
  );
  const [gdriveToken, setGdriveTokenState] = useState<string | null>(
    getGdriveToken,
  );
  const [encryption, setEncryptionState] =
    useState<EncryptionMode>(getEncryption);
  // Session-only passphrase. Never persisted — lost on reload by design.
  const [password, setPassword] = useState<string | null>(null);
  // The picked local folder (File System Access API). `null` until the boot
  // probe resolves, the user picks one, or a revoked grant drops it.
  const [folderHandle, setFolderHandle] =
    useState<FileSystemDirectoryHandle | null>(null);
  // Gates the folder branch of the adapter memo until the boot probe has run,
  // so we don't briefly build a folder adapter without a handle.
  const [folderHandleLoaded, setFolderHandleLoaded] = useState<boolean>(
    () => getBackend() !== "folder",
  );
  const [folderReconnectNeeded, setFolderReconnectNeeded] = useState(false);
  // The namespaces known on this device and which one is active. The list is
  // seeded from localStorage (and reconciled against the backend's
  // `namespaces.json` once a file backend resolves); the active pointer is a
  // per-device cursor selecting which document the adapter reads/writes.
  const [namespaces, setNamespacesState] = useState<Namespace[]>(getNamespaces);
  const [activeNamespace, setActiveNamespaceState] = useState<string>(
    getActiveNamespaceSlug,
  );

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

  // Complete a Dropbox OAuth redirect on boot. Google Drive uses a popup
  // (resolved inline in `connectGdrive`), so only Dropbox lands back here
  // with a `?code=`.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code || !hasPendingDropboxAuth()) return;
    let cancelled = false;
    void (async () => {
      try {
        log.info("boot: completing Dropbox OAuth redirect");
        const result = await completeDropboxAuth(code);
        if (cancelled) return;
        setDropboxToken(result.accessToken);
        setDropboxTokenState(result.accessToken);
        if (result.refreshToken) {
          setDropboxRefreshToken(result.refreshToken);
          setDropboxRefreshState(result.refreshToken);
        }
        persistBackend("dropbox");
        setBackendState("dropbox");
        unlockAchievement("cloudWalker");
      } catch (err) {
        log.error("boot: Dropbox OAuth completion failed", err);
      } finally {
        if (!cancelled) cleanAuthParamsFromUrl();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve the active backend once. Both builders below switch on this
  // single selection rather than re-deriving the `backend && token` chain.
  const selection = useMemo<BackendSelection>(() => {
    if (backend === "dropbox" && dropboxToken) {
      return {
        kind: "dropbox",
        auth: {
          accessToken: dropboxToken,
          refreshToken: dropboxRefresh,
          onAccessTokenRefreshed: (token) => {
            setDropboxToken(token);
            setDropboxTokenState(token);
          },
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
    folderHandle,
    folderHandleLoaded,
  ]);

  // The unwrapped, namespace-scoped backend. Cloud adapters get fresh tokens
  // on every change so a reconnect rebuilds them; the Dropbox adapter persists
  // any silently refreshed access token back via the selection's
  // `onAccessTokenRefreshed`. Keyed on `activeNamespace` so switching the
  // namespace rebuilds the document adapter (and its offline cache) onto the
  // new namespace's storage location.
  const inner = useMemo<StorageAdapter>(() => {
    switch (selection.kind) {
      // Cloud backends mirror their bytes into a local cache so the document
      // can be unlocked, read, and edited offline (the cache holds the
      // encrypted envelope when encryption is on). Folder / browser are
      // already on-device, so they need no mirror.
      case "dropbox":
        return withLocalCache(
          createDropboxAdapter(selection.auth, fetch, activeNamespace),
          {
            storage: globalThis.localStorage,
            key: localCacheKey("dropbox", activeNamespace),
          },
        );
      case "gdrive":
        return withLocalCache(
          createGdriveAdapter(selection.token, fetch, activeNamespace),
          {
            storage: globalThis.localStorage,
            key: localCacheKey("gdrive", activeNamespace),
          },
        );
      case "folder":
        return createFolderAdapter({
          directoryHandle: selection.handle,
          namespace: activeNamespace,
          onPermissionLost: markFolderPermissionLost,
        });
      case "browser":
        return new BrowserLocalStorageAdapter(
          globalThis.localStorage,
          activeNamespace,
        );
    }
  }, [selection, activeNamespace, markFolderPermissionLost]);

  // The active backend's root settings store — the same selection as `inner`
  // but independent of encryption (settings are app-wide plaintext). Null for
  // the browser backend (localStorage is its canonical settings home).
  const settingsStore = useMemo<SettingsStore | null>(() => {
    switch (selection.kind) {
      case "dropbox":
        return createDropboxSettingsStore(selection.auth);
      case "gdrive":
        return createGdriveSettingsStore(selection.token);
      case "folder":
        return createFolderSettingsStore(
          selection.handle,
          markFolderPermissionLost,
        );
      case "browser":
        return null;
    }
  }, [selection, markFolderPermissionLost]);

  // The active backend's root namespace registry — `namespaces.json` beside
  // `settings.json` at the app-folder root, so the list of namespaces travels
  // with the synced/shared folder and lands on every device that connects the
  // backend. Null for the browser backend (localStorage is its only home) and
  // while a folder grant is unresolved.
  const namespaceStore = useMemo<NamespaceRegistryStore | null>(() => {
    switch (selection.kind) {
      case "dropbox":
        return createDropboxNamespaceStore(selection.auth);
      case "gdrive":
        return createGdriveNamespaceStore(selection.token);
      case "folder":
        return createFolderNamespaceStore(
          selection.handle,
          markFolderPermissionLost,
        );
      case "browser":
        return null;
    }
  }, [selection, markFolderPermissionLost]);

  // Best-effort push of the current device registry to the active backend.
  // Shared by the create / rename / appearance / remove verbs so a mutation
  // is mirrored into `namespaces.json` the same way the appearance settings
  // mirror `settings.json`. A no-op on the browser backend (no store).
  const pushNamespaces = useCallback(
    (list: Namespace[]) => {
      void Promise.resolve(
        namespaceStore?.save(serializeNamespaces(list)),
      ).catch(() => {
        // A failed write leaves the local copy, which the next reconcile or
        // mutation re-pushes.
      });
    },
    [namespaceStore],
  );

  // Reconcile the device's namespace list with the backend's `namespaces.json`
  // when a file backend is (re)selected. The backend wins on any slug both
  // sides know, and this device's own namespaces are merged in and pushed
  // back up — so connecting on a new device adopts the cloud's lists and
  // uploads any local-only ones rather than dropping them. A missing remote
  // file is seeded from this device (the first device to connect publishes).
  useEffect(() => {
    if (!namespaceStore) return;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await namespaceStore.load();
        if (cancelled) return;
        const local = getNamespaces();
        if (raw === null) {
          await namespaceStore.save(serializeNamespaces(local));
          return;
        }
        const remote = parseNamespaces(raw);
        const merged = mergeNamespaceLists(local, remote);
        registrySetNamespaces(merged);
        setNamespacesState(getNamespaces());
        if (hasLocalOnlyNamespaces(local, remote)) {
          await namespaceStore.save(serializeNamespaces(getNamespaces()));
        }
      } catch {
        // Backend unreachable / malformed — keep the local registry.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [namespaceStore]);

  const locked = encryption === "encrypted" && password === null;

  // The adapter handed to the app. Wrapped with encryption when on; replaced
  // by the locked placeholder until the passphrase is supplied.
  const adapter = useMemo<StorageAdapter>(() => {
    if (locked) return lockedAdapter(backend);
    if (encryption === "encrypted") {
      return withEncryption(inner, { current: password });
    }
    return inner;
  }, [inner, encryption, password, locked, backend]);

  const selectBrowser = useCallback(() => {
    persistBackend("browser");
    setBackendState("browser");
  }, []);

  // Wrap a raw adapter in the session's encryption envelope so a folder probe
  // / seed / mirror reads and writes the same bytes the steady-state app does.
  // A no-op when encryption is off (or locked).
  const wrapForActive = useCallback(
    (raw: StorageAdapter): StorageAdapter =>
      encryption === "encrypted" && password !== null
        ? withEncryption(raw, { current: password })
        : raw,
    [encryption, password],
  );

  // Pick a folder and switch to it. When the folder is empty, seed it with the
  // current document so the switch doesn't blank the screen; when it already
  // holds notes, adopt them (the folder wins). The handle is persisted to
  // IndexedDB so the grant survives reloads.
  const connectFolder = useCallback(async () => {
    if (typeof window === "undefined" || !window.showDirectoryPicker) return;
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch (err) {
      // AbortError = the user dismissed the picker; nothing to do.
      if (err instanceof DOMException && err.name === "AbortError") return;
      log.error("folder picker failed", err);
      return;
    }
    const folder = wrapForActive(
      createFolderAdapter({
        directoryHandle: handle,
        namespace: activeNamespace,
      }),
    );
    try {
      const [remote, source] = await Promise.all([
        folder.load().catch(() => null),
        adapter.load().catch(() => null),
      ]);
      if (!remote && source) await folder.save(source.text);
    } catch (err) {
      log.error("folder seed failed", err);
    }
    await saveDirectoryHandle(handle);
    persistBackend("folder");
    setFolderHandle(handle);
    setFolderReconnectNeeded(false);
    setFolderHandleLoaded(true);
    setBackendState("folder");
    unlockAchievement("localVault");
  }, [activeNamespace, adapter, wrapForActive]);

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
    if (folderHandle) {
      try {
        const folder = wrapForActive(
          createFolderAdapter({
            directoryHandle: folderHandle,
            namespace: activeNamespace,
          }),
        );
        const snap = await folder.load();
        if (snap) {
          const browser = wrapForActive(
            new BrowserLocalStorageAdapter(
              globalThis.localStorage,
              activeNamespace,
            ),
          );
          await browser.save(snap.text);
        }
      } catch (err) {
        log.error("folder disconnect: mirror to browser failed", err);
      }
    }
    await clearDirectoryHandle();
    persistBackend("browser");
    setFolderHandle(null);
    setFolderReconnectNeeded(false);
    setBackendState("browser");
  }, [folderHandle, activeNamespace, wrapForActive]);

  const connectDropbox = useCallback(() => {
    // Redirects away; completion runs in the boot effect above — anything
    // queued here wouldn't survive the redirect.
    void startDropboxAuth();
  }, []);

  const disconnectDropbox = useCallback(() => {
    clearDropboxToken();
    clearDropboxRefreshToken();
    setDropboxTokenState(null);
    setDropboxRefreshState(null);
    persistBackend("browser");
    setBackendState("browser");
  }, []);

  const connectGdrive = useCallback(async () => {
    const token = await startGdriveAuth();
    setGdriveToken(token);
    setGdriveTokenState(token);
    persistBackend("gdrive");
    setBackendState("gdrive");
    unlockAchievement("cloudWalker");
  }, []);

  const disconnectGdrive = useCallback(() => {
    clearGdriveToken();
    setGdriveTokenState(null);
    persistBackend("browser");
    setBackendState("browser");
  }, []);

  const enableEncryption = useCallback(
    async (next: string) => {
      if (!next) throw new Error("Passphrase is required");
      // Re-wrap whatever the inner backend currently holds so existing
      // plaintext becomes an envelope. A first run with no data is a no-op
      // beyond flipping the flag.
      const snap = await inner.load();
      if (snap && !isEncryptedEnvelope(snap.text)) {
        const payload = await encryptText(snap.text, next);
        await inner.save(payload, snap.revision);
      }
      persistEncryption("encrypted");
      setEncryptionState("encrypted");
      setPassword(next);
      unlockAchievement("paranoidMode");
    },
    [inner],
  );

  const disableEncryption = useCallback(async () => {
    if (password === null) {
      throw new Error("Unlock before turning encryption off");
    }
    const snap = await inner.load();
    if (snap && isEncryptedEnvelope(snap.text)) {
      const plaintext = await decryptEnvelope(snap.text, password);
      await inner.save(plaintext, snap.revision);
    }
    persistEncryption("plaintext");
    setEncryptionState("plaintext");
    setPassword(null);
  }, [inner, password]);

  const unlock = useCallback(
    async (candidate: string) => {
      if (!candidate) throw new Error("Passphrase is required");
      // Verify by decrypting the stored envelope. For a cloud backend the
      // load falls back to the on-device cache when offline, so the
      // passphrase can be checked in airplane mode against the cached
      // ciphertext. If the backend is unreachable *and* nothing is cached,
      // map it to a distinct error so the gate says "you're offline" instead
      // of the misleading "wrong passphrase".
      let snap: StoredSnapshot | null;
      try {
        snap = await inner.load();
      } catch (err) {
        log.warn("unlock: backend unreachable and no cached copy", err);
        throw new OfflineUnavailableError();
      }
      // Plaintext-at-rest (the re-wrap never ran) can't be verified, so it
      // unlocks optimistically.
      if (snap && isEncryptedEnvelope(snap.text)) {
        await decryptEnvelope(snap.text, candidate); // throws on wrong pass
      }
      setPassword(candidate);
    },
    [inner],
  );

  const switchNamespace = useCallback((slug: string) => {
    setActiveNamespaceSlug(slug);
    setActiveNamespaceState(slug);
  }, []);

  const createNamespace = useCallback(
    (name: string, appearance?: NamespaceAppearance) => {
      const created = registryAddNamespace(name);
      // Apply the icon / colour the user picked at creation time, if any,
      // before reading the registry back into state.
      if (appearance && (appearance.glyph || appearance.color)) {
        registrySetNamespaceAppearance(created.slug, appearance);
      }
      setNamespacesState(getNamespaces());
      pushNamespaces(getNamespaces());
      // Land the user in the namespace they just created.
      setActiveNamespaceSlug(created.slug);
      setActiveNamespaceState(created.slug);
      unlockAchievement("compartments");
    },
    [pushNamespaces],
  );

  const renameNamespace = useCallback(
    (slug: string, name: string) => {
      registryRenameNamespace(slug, name);
      setNamespacesState(getNamespaces());
      pushNamespaces(getNamespaces());
    },
    [pushNamespaces],
  );

  const setNamespaceAppearance = useCallback(
    (slug: string, patch: NamespaceAppearance) => {
      registrySetNamespaceAppearance(slug, patch);
      setNamespacesState(getNamespaces());
      pushNamespaces(getNamespaces());
    },
    [pushNamespaces],
  );

  const removeNamespace = useCallback(
    async (slug: string) => {
      if (slug === DEFAULT_NAMESPACE_SLUG) {
        throw new Error("The default namespace can't be removed");
      }
      // Delete the namespace's bytes in whatever backend is active right now —
      // that's the only one we hold a connection / key for. A failure
      // (offline, revoked token) is logged but doesn't block removing the
      // registry entry; the user can clean up orphaned bytes manually.
      try {
        if (backend === "browser") {
          deleteLocalNamespace(slug);
        } else if (backend === "folder" && folderHandle) {
          // Remove the namespace's whole subfolder (and its markdown files).
          await folderHandle
            .removeEntry(slug, { recursive: true })
            .catch(() => {});
        } else if (backend === "dropbox" && dropboxToken) {
          await deleteDropboxNamespace(dropboxToken, slug);
        } else if (backend === "gdrive" && gdriveToken) {
          await deleteGdriveNamespace(gdriveToken, slug);
        }
      } catch (err) {
        log.warn(`removeNamespace: data delete failed for ${slug}`, err);
      }
      registryRemoveNamespace(slug);
      setNamespacesState(getNamespaces());
      pushNamespaces(getNamespaces());
      if (activeNamespace === slug) {
        setActiveNamespaceSlug(DEFAULT_NAMESPACE_SLUG);
        setActiveNamespaceState(DEFAULT_NAMESPACE_SLUG);
      }
    },
    [
      backend,
      dropboxToken,
      gdriveToken,
      activeNamespace,
      folderHandle,
      pushNamespaces,
    ],
  );

  return {
    adapter,
    settingsStore,
    backend,
    dropboxConfigured: isDropboxConfigured(),
    gdriveConfigured: isGdriveConfigured(),
    dropboxConnected: dropboxToken !== null,
    gdriveConnected: gdriveToken !== null,
    folderAvailable: isFolderBackendAvailable(),
    folderConnected: backend === "folder" && folderHandle !== null,
    folderReconnectNeeded,
    encryption,
    locked,
    selectBrowser,
    connectFolder,
    reconnectFolder,
    disconnectFolder,
    connectDropbox,
    disconnectDropbox,
    connectGdrive,
    disconnectGdrive,
    enableEncryption,
    disableEncryption,
    unlock,
    namespaces,
    activeNamespace,
    switchNamespace,
    createNamespace,
    renameNamespace,
    setNamespaceAppearance,
    removeNamespace,
  };
}
