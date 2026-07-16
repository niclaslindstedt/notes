// Top-level storage wiring, as a hook. Selects the active `StorageAdapter`
// from the per-device backend preference and layers optional at-rest
// encryption on top. The cloud (Dropbox / Google Drive) OAuth tokens and the
// boot-redirect completion live in `useCloudBackend`; the picked-folder
// lifecycle in `useFolderBackend`; the encryption state machine in
// `useEncryption`; the namespace registry in `useNamespaceRegistry`. Collapsed
// to fit an account-less, single-document app.
//
// Encryption note: there are no user accounts, so the encryption passphrase
// isn't derived from a login — it's set explicitly in Settings and held only
// in memory for the session. After a reload the app is "locked" (encryption
// is on but no passphrase is held) until the user re-enters it; the `locked`
// flag drives the unlock gate in `App`.

import { useCallback, useMemo, useRef, useState } from "react";

import { createLogger } from "../dev/logger.ts";
import type { Folder, Note } from "../domain/note.ts";
import type {
  NoteConversionStep,
  StorageAdapter,
  StoredSnapshot,
} from "./adapter.ts";
import { bytesToDataUrl } from "./attachment-store.ts";
import {
  type BackendId,
  type EncryptionMode,
  getBackend,
  setBackend as persistBackend,
} from "./backend-preference.ts";
import {
  createDropboxNamespaceStore,
  createDropboxSettingsStore,
  isDropboxConfigured,
} from "./dropbox/index.ts";
import { withEncryption } from "./encrypting/index.ts";
import {
  createGdriveNamespaceStore,
  createGdriveSettingsStore,
  isGdriveConfigured,
} from "./gdrive/index.ts";
import {
  createFolderNamespaceStore,
  createFolderSettingsStore,
} from "./folder/index.ts";
import type { NamespaceRegistryStore } from "./namespace-store.ts";
import type { Namespace, NamespaceAppearance } from "./namespaces.ts";
import {
  type NamespaceRegistry,
  useNamespaceRegistry,
} from "./useNamespaceRegistry.ts";
import type { SettingsStore } from "./settings-store.ts";
import { isFolderBackendAvailable } from "./folder/handle-store.ts";
import {
  type EncryptionProgress,
  type EncryptionProgressDetail,
  type EncryptionProgressStep,
  useEncryption,
} from "./useEncryption.ts";
import { type FolderActiveRef, useFolderBackend } from "./useFolderBackend.ts";
import { useCloudBackend } from "./useCloudBackend.ts";
import { useNotesdBackend } from "./useNotesdBackend.ts";
import { useNotesdDiscovery } from "./useNotesdDiscovery.ts";
import { useNamespaceMigration } from "./useNamespaceMigration.ts";
import { useBackendSelection } from "./useBackendSelection.ts";
import { createPinnedFetch, isNative } from "../platform/native-bridge.ts";
import {
  createNotesdNamespaceStore,
  createNotesdSettingsStore,
} from "./notesd/index.ts";
import type { NotesdConnectRequest } from "./notesd/pairing.ts";
import type { PublishedDaemon } from "./notesd/config-plane.ts";

const log = createLogger("storage");

// Re-exported from their new home in `useEncryption.ts` so the settings UI's
// `encryption-progress.ts` import path stays unchanged.
export type {
  EncryptionProgress,
  EncryptionProgressDetail,
  EncryptionProgressStep,
};

export interface UseStorageBackend {
  /** The adapter to hand to the sync engine. A no-op placeholder while locked. */
  adapter: StorageAdapter;
  /**
   * Fetch one attachment's bytes as a `data:` URL on demand (the note list
   * loads without them). Returns null on a backend with no attachment store, or
   * when the attachment isn't found.
   */
  fetchAttachment: (note: Note, filename: string) => Promise<string | null>;
  /** The active adapter's per-note at-rest encryption status, if it tracks it. */
  getEncryptionStatus?: () => Map<string, "encrypted" | "pending">;
  /** Rebuild + seal the note index from the snapshot, if the backend keeps one. */
  refreshIndex?: (notes: readonly Note[]) => Promise<void>;
  /** Convert one note to encrypted at rest (idempotent), if supported. */
  migrateNote?: (
    note: Note,
    onStep?: (step: NoteConversionStep) => void,
  ) => Promise<boolean>;
  /** Convert one note back to plaintext at rest (idempotent), if supported. */
  demigrateNote?: (
    note: Note,
    onStep?: (step: NoteConversionStep) => void,
  ) => Promise<boolean>;
  /** Upgrade a legacy whole-document encrypted blob to per-file form (one-time). */
  splitLegacyBlob?: () => Promise<boolean>;
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
  /**
   * True when the locked state was triggered by discovering the backend is
   * encrypted (encryption was turned on from another device) rather than a
   * plain reload of an already-encrypted store. Lets the unlock gate say so.
   */
  encryptionFromRemote: boolean;
  /**
   * On a file/cloud backend, true while the background de-encryption queue is
   * draining (mode is still `encrypted` and the passphrase still held until the
   * last note is back to plaintext). Drives the reverse conversion and keeps the
   * settings UI showing "turning off" rather than a finished state.
   */
  encryptionDisabling: boolean;
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
  /**
   * Whether the self-hosted (notesd) backend is offerable here — only inside
   * the native wrapper, whose pinned fetch can reach a self-signed daemon.
   */
  notesdAvailable: boolean;
  /** Whether a notesd daemon is currently paired. */
  notesdConnected: boolean;
  /** Pair with a daemon (from a pasted URI or a discovered entry) and switch to it. */
  pairNotesd: (request: NotesdConnectRequest) => Promise<void>;
  /** Forget the paired daemon and fall back to the browser store. */
  unpairNotesd: () => void;
  /**
   * Daemons discovered in the connected cloud's `notesd.json` (config plane),
   * so a device can pair with a known daemon without its QR — empty unless a
   * cloud backend is connected and this is the native app.
   */
  notesdDiscovered: PublishedDaemon[];
  /** The cloud discovery reads from ("Dropbox" / "Google Drive"), or null. */
  notesdDiscoverySource: "Dropbox" | "Google Drive" | null;
  /** Re-read the config plane on demand. */
  refreshNotesdDiscovery: () => void;
  /**
   * Turn encryption on with a fresh passphrase, re-wrapping stored bytes.
   * `onProgress` (optional) fires once per phase so the UI can show progress.
   */
  enableEncryption: (
    password: string,
    onProgress?: EncryptionProgress,
  ) => Promise<void>;
  /**
   * Turn encryption off. On the browser backend this decrypts the whole
   * document in one pass (`onProgress` fires per phase). On a file/cloud backend
   * it only *starts* the reverse: it raises `encryptionDisabling` and the
   * background queue decrypts note-by-note, calling `finishDisableEncryption`
   * when the last one lands — so the modal can be closed while it runs.
   */
  disableEncryption: (onProgress?: EncryptionProgress) => Promise<void>;
  /**
   * Finalise a file/cloud de-encryption: drop the passphrase and switch the
   * persisted mode to plaintext. Called by the background queue once every note
   * is decrypted; never called directly by the UI.
   */
  finishDisableEncryption: () => void;
  /** Supply the passphrase for an already-encrypted store; throws if wrong. */
  unlock: (password: string, onProgress?: EncryptionProgress) => Promise<void>;
  /**
   * Adopt an encrypted backend discovered on load — flip this device to
   * `encrypted` (no passphrase) so it locks behind the unlock gate. Called by
   * the sync engine when a load surfaces `EncryptedRemoteError`, so encryption
   * enabled on one device is enforced on every device sharing the folder.
   */
  adoptEncryptedRemote: () => void;
  /** Namespaces known on this device (default always first). */
  namespaces: Namespace[];
  /** The active namespace's slug. */
  activeNamespace: string;
  /** Make a namespace active, swapping which document the app reads/writes. */
  switchNamespace: (slug: string) => void;
  /**
   * Move a note (with its attachment bytes) into another namespace on the same
   * backend: write it into the target namespace's document, returning true on
   * success. The caller removes it from the source namespace. A no-op (false)
   * for the active namespace, an unknown target, or while locked.
   */
  moveNoteToNamespace: (note: Note, targetSlug: string) => Promise<boolean>;
  /**
   * Move a whole folder — its record and every note filed in it (with their
   * bodies and attachment bytes) — into another namespace on the same backend.
   * Writes them into the target namespace's document, keeping each note filed
   * under the folder, and returns true on success. The caller removes the
   * folder and its notes from the source namespace. A no-op (false) for the
   * active namespace, an unknown target, or while locked.
   */
  moveFolderToNamespace: (
    folder: Folder,
    notes: Note[],
    targetSlug: string,
  ) => Promise<boolean>;
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

export function useStorageBackend(): UseStorageBackend {
  const [backend, setBackendState] = useState<BackendId>(getBackend);
  // The active document adapter, exposed to the encryption verbs through a ref
  // they read at call time. Assigned right after `inner` is built below; null
  // only during the first render pass, before any verb can fire. This breaks
  // the render-order cycle: `useEncryption` produces the `directoryCrypto` /
  // `seal` / `unseal` that build the very adapter its verbs need.
  const innerRef = useRef<StorageAdapter | null>(null);
  const {
    directoryCrypto,
    seal,
    unseal,
    passwordRef,
    encryption,
    locked,
    disabling,
    fromRemote,
    wrapBrowserForActive,
    enableEncryption,
    disableEncryption,
    finishDisableEncryption,
    unlock,
    adoptEncryptedRemote,
  } = useEncryption(innerRef, backend);
  // Persist + activate a backend in one call (localStorage preference + the
  // re-render). Handed to the folder hook, whose connect / disconnect verbs
  // switch the active backend.
  const selectBackend = useCallback((id: BackendId) => {
    persistBackend(id);
    setBackendState(id);
  }, []);

  // The active document adapter + namespace the folder hook's connect /
  // disconnect verbs read at call time. Assigned right after `adapter` is built
  // below; the verbs only fire from UI mounted well after that, so it's never
  // read while null. This breaks the folder hook's render-order cycle: it
  // produces the `folderHandle` the backend selection (and so the adapter) is
  // built from.
  const folderActiveRef = useRef<FolderActiveRef["current"]>(null);

  // The picked-folder concern: the live FSA handle and its boot-probe
  // rehydration, the revoked-grant reconnect cue, and the connect / reconnect /
  // disconnect verbs. Produces `folderHandle` / `folderHandleLoaded` /
  // `markFolderPermissionLost`, which the selection / adapter / store memos
  // below key off — so it runs before them.
  const {
    folderHandle,
    folderHandleLoaded,
    folderReconnectNeeded,
    markFolderPermissionLost,
    connectFolder,
    reconnectFolder,
    disconnectFolder,
  } = useFolderBackend({
    activeRef: folderActiveRef,
    directoryCrypto,
    wrapBrowserForActive,
    selectBackend,
  });

  // The cloud (Dropbox + Google Drive) concern: the access / refresh token
  // state, the connect / disconnect verbs, and the Dropbox boot-redirect
  // completion. Produces the tokens `selection` (and the namespace registry)
  // key off — so it runs before them.
  const {
    dropboxToken,
    dropboxRefresh,
    gdriveToken,
    rememberDropboxAccessToken,
    connectDropbox,
    disconnectDropbox,
    connectGdrive,
    disconnectGdrive,
  } = useCloudBackend({ selectBackend });

  // The notesd (self-hosted daemon) concern: the paired config + pair / unpair
  // verbs. Native-only — the pinned fetch it rides rejects on the plain web.
  const {
    notesdConfig,
    pairNotesd: rawPairNotesd,
    unpairNotesd,
  } = useNotesdBackend({ selectBackend });

  // The notesd config plane: discover daemons your other devices published to
  // the connected cloud, and publish this device's pairings there. Native-only.
  const {
    discoveredDaemons: notesdDiscovered,
    discoverySource: notesdDiscoverySource,
    refreshDiscovery: refreshNotesdDiscovery,
    publishDaemon: publishNotesdDaemon,
  } = useNotesdDiscovery({
    dropboxToken,
    dropboxRefresh,
    rememberDropboxAccessToken,
    gdriveToken,
    enabled: isNative(),
  });

  // Pair, then publish the daemon's non-secret discovery record (name, endpoint,
  // pin) to the connected cloud so other devices can find it. Publishing is
  // best-effort inside the hook and never blocks the pairing.
  const pairNotesd = useCallback(
    async (request: NotesdConnectRequest) => {
      const config = await rawPairNotesd(request);
      await publishNotesdDaemon({
        name: config.name,
        endpoint: config.endpoint,
        fingerprint: config.spkiPin,
      });
    },
    [rawPairNotesd, publishNotesdDaemon],
  );

  // Resolve the active backend once, and get the factory that builds an
  // adapter for any namespace on it. Both the root stores below and the
  // active-document adapter switch on this single selection.
  const { selection, makeInner } = useBackendSelection({
    backend,
    dropboxToken,
    dropboxRefresh,
    gdriveToken,
    rememberDropboxAccessToken,
    notesdConfig,
    folderHandle,
    folderHandleLoaded,
    markFolderPermissionLost,
    directoryCrypto,
    seal,
    unseal,
  });

  // The active backend's root namespace registry — `namespaces.json` beside
  // `settings.json` at the app-folder root, so the list of namespaces travels
  // with the synced/shared folder and lands on every device that connects the
  // backend. Built from the same selection as the document adapter (and the
  // `settingsStore` below), but kept here — not inside `useNamespaceRegistry` —
  // because it's the symmetric sibling of `settingsStore`. Null for the browser
  // backend (localStorage is its only home) and while a folder grant is
  // unresolved.
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
      // notesd serves `namespaces.json` from the daemon (`/v1/settings/...`)
      // over the SPKI-pinned fetch, so the namespace list travels with the
      // daemon and lands on every paired device.
      case "notesd":
        return createNotesdNamespaceStore(
          selection.config,
          createPinnedFetch(selection.config.spkiPin),
        );
      // The browser backend keeps its registry in localStorage and has no
      // separate store.
      case "browser":
        return null;
    }
  }, [selection, markFolderPermissionLost]);

  // The device's namespace list + active cursor, its reconciliation against the
  // backend's `namespaces.json`, and the create / rename / appearance / remove /
  // switch verbs. Produces `activeNamespace`, which `makeInner` / `inner` below
  // key off — so it must run before them.
  const {
    namespaces,
    activeNamespace,
    switchNamespace,
    createNamespace,
    renameNamespace,
    setNamespaceAppearance,
    removeNamespace,
  }: NamespaceRegistry = useNamespaceRegistry({
    namespaceStore,
    backend,
    dropboxToken,
    gdriveToken,
    folderHandle,
    notesdConfig,
  });

  // The active namespace's adapter — rebuilt when the namespace or backend
  // changes so it (and its offline cache) point at the right storage location.
  const inner = useMemo<StorageAdapter>(
    () => makeInner(activeNamespace),
    [makeInner, activeNamespace],
  );
  // Hand the live adapter to the encryption verbs, which read it at call time
  // (always well after this first assignment).
  innerRef.current = inner;

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
      // notesd serves `settings.json` from the daemon (`/v1/settings/...`) over
      // the SPKI-pinned fetch, so appearance settings sync across paired devices.
      case "notesd":
        return createNotesdSettingsStore(
          selection.config,
          createPinnedFetch(selection.config.spkiPin),
        );
      // The browser backend keeps settings in localStorage (the appearance
      // store's cache is its home) and has no separate store.
      case "browser":
        return null;
    }
  }, [selection, markFolderPermissionLost]);

  // The adapter handed to the app. While locked, a no-op placeholder. The
  // file/cloud backends encrypt per-file *inside* the directory adapter (via
  // `directoryCrypto`), so only the single-document browser backend still needs
  // the whole-document `withEncryption` wrapper.
  const adapter = useMemo<StorageAdapter>(() => {
    if (locked) return lockedAdapter(backend);
    // Only the single-document browser store seals the whole blob here; the
    // file/cloud backends and notesd encrypt per file inside the directory
    // adapter instead.
    if (encryption === "encrypted" && selection.kind === "browser") {
      return withEncryption(inner, passwordRef);
    }
    return inner;
  }, [inner, encryption, locked, backend, selection.kind, passwordRef]);
  // Hand the live adapter + namespace to the folder verbs, which read them at
  // call time (always well after this first assignment).
  folderActiveRef.current = { adapter, activeNamespace };

  // On-demand attachment fetch, surfaced as a `data:` URL for the UI. Bound to
  // the active adapter; a no-op (null) on backends without an attachment store.
  const fetchAttachment = useCallback(
    async (note: Note, filename: string): Promise<string | null> => {
      const got = await adapter.fetchAttachment?.(note, filename);
      if (!got) return null;
      return bytesToDataUrl(got.mime, got.bytes);
    },
    [adapter],
  );

  // The adapter's at-rest encryption surface, bound once per adapter so the
  // identity is stable across re-renders. The background conversion effect keys
  // off these, so a fresh `.bind()` every render would otherwise restart it on
  // every status tick.
  const getEncryptionStatus = useMemo(
    () => adapter.getEncryptionStatus?.bind(adapter),
    [adapter],
  );
  const refreshIndex = useMemo(
    () => adapter.refreshIndex?.bind(adapter),
    [adapter],
  );
  const migrateNote = useMemo(
    () => adapter.migrateNote?.bind(adapter),
    [adapter],
  );
  const demigrateNote = useMemo(
    () => adapter.demigrateNote?.bind(adapter),
    [adapter],
  );
  const splitLegacyBlob = useMemo(
    () => adapter.splitLegacyBlob?.bind(adapter),
    [adapter],
  );

  const selectBrowser = useCallback(() => {
    persistBackend("browser");
    setBackendState("browser");
  }, []);

  // The two cross-namespace move verbs live in their own leaf hook, fed the
  // resolved selection this orchestrator already built.
  const { moveNoteToNamespace, moveFolderToNamespace } = useNamespaceMigration({
    locked,
    activeNamespace,
    namespaces,
    inner,
    isBrowserBackend: selection.kind === "browser",
    wrapBrowserForActive,
    makeInner,
  });

  return {
    adapter,
    fetchAttachment,
    getEncryptionStatus,
    refreshIndex,
    migrateNote,
    demigrateNote,
    splitLegacyBlob,
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
    encryptionFromRemote: fromRemote,
    encryptionDisabling: disabling,
    selectBrowser,
    connectFolder,
    reconnectFolder,
    disconnectFolder,
    connectDropbox,
    disconnectDropbox,
    connectGdrive,
    disconnectGdrive,
    notesdAvailable: isNative(),
    notesdConnected: backend === "notesd" && notesdConfig !== null,
    pairNotesd,
    unpairNotesd,
    notesdDiscovered,
    notesdDiscoverySource,
    refreshNotesdDiscovery,
    enableEncryption,
    disableEncryption,
    finishDisableEncryption,
    unlock,
    adoptEncryptedRemote,
    namespaces,
    activeNamespace,
    switchNamespace,
    moveNoteToNamespace,
    moveFolderToNamespace,
    createNamespace,
    renameNamespace,
    setNamespaceAppearance,
    removeNamespace,
  };
}
