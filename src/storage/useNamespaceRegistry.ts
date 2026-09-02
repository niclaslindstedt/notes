// The namespace-registry concern of the storage backend, extracted from
// `useStorageBackend` into a self-contained hook: the device's namespace list
// and active-namespace cursor, the reconciliation against the backend's
// `namespaces.json`, and the create / rename / appearance / remove / switch
// verbs.
//
// A namespace is a named bucket holding its own note document; the active one
// selects which storage location every backend reads/writes. The list is
// seeded from localStorage and reconciled against the backend's root
// `namespaces.json` (beside `settings.json`) so it travels with a synced /
// shared folder and lands on every device that connects the backend.
//
// Unlike the encryption seam, this hook produces nothing the document-adapter
// factory consumes, so it has no render-order cycle: it takes the already-built
// `namespaceStore` (the orchestrator builds it next to `settingsStore`, both
// derived from the same backend selection) plus the live backend handles a
// namespace data-delete needs, all as plain args.

import { useCallback, useEffect, useState } from "react";

// Aliased: this module's `unlock` arg would otherwise shadow the achievement.
import { unlock as unlockAchievement } from "../achievements/index.ts";
import { createLogger } from "../dev/logger.ts";
import { createPinnedFetch } from "../platform/native-bridge.ts";
import {
  clearEncryption,
  type BackendId,
  type NextcloudConfig,
  type NotesdConfig,
} from "./backend-preference.ts";
import { deleteLocalNamespace } from "./local/index.ts";
import type { NamespaceRegistryStore } from "./namespace-store.ts";
import { createNamespacePin, verifyNamespacePin } from "./namespace-pin.ts";
import {
  type Namespace,
  type NamespaceAppearance,
  DEFAULT_NAMESPACE_SLUG,
  addNamespace as registryAddNamespace,
  getNamespaces,
  hasLocalOnlyNamespaces,
  mergeNamespaceLists,
  parseNamespaces,
  removeNamespace as registryRemoveNamespace,
  renameNamespace as registryRenameNamespace,
  serializeNamespaces,
  setActiveNamespaceSlug,
  setNamespaceAppearance as registrySetNamespaceAppearance,
  setNamespacePin as registrySetNamespacePin,
  setNamespaces as registrySetNamespaces,
} from "./namespaces.ts";

// Namespaces whose PIN has been entered, for this page's lifetime only. Module
// state rather than component state so a re-mount (a namespace switch, a
// modal) doesn't re-prompt, and deliberately *not* persisted: a PIN that
// survived a reload would only be gating the first tap of the session, which
// is not a gate at all.
const pinsEntered = new Set<string>();

const log = createLogger("storage");

export interface NamespaceRegistry {
  /** Namespaces known on this device (default always first). */
  namespaces: Namespace[];
  /** Whether a namespace is gated by a PIN at all. */
  namespaceHasPin: (slug: string) => boolean;
  /** Whether a namespace is gated and its PIN hasn't been entered this session. */
  isNamespacePinLocked: (slug: string) => boolean;
  /** True when the **active** namespace is behind an unentered PIN. */
  pinLocked: boolean;
  /**
   * Try a PIN for the active namespace. Resolves true when it matched (and
   * the namespace is open for the rest of the session), false otherwise.
   */
  enterNamespacePin: (code: string) => Promise<boolean>;
  /**
   * Set or change a namespace's PIN. `current` must be the existing code when
   * one is set — anyone sharing the namespace can change its PIN, but only by
   * proving they can already open it. Resolves false when `current` is wrong.
   */
  setNamespacePin: (
    slug: string,
    code: string,
    current?: string,
  ) => Promise<boolean>;
  /** Remove a namespace's PIN, proving the current code first. */
  clearNamespacePin: (slug: string, current: string) => Promise<boolean>;
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

/**
 * The live backend handles a namespace data-delete reaches for. Threaded in
 * from the orchestrator because they're the only connection / key held — a
 * removal can only delete the namespace's bytes in whatever backend is active.
 */
export interface NamespaceRegistryDeps {
  /** The active backend's `namespaces.json` store, or null (browser backend). */
  namespaceStore: NamespaceRegistryStore | null;
  backend: BackendId;
  dropboxToken: string | null;
  gdriveToken: string | null;
  folderHandle: FileSystemDirectoryHandle | null;
  /** The stored Nextcloud connection, null unless it is the active backend. */
  nextcloudConfig: NextcloudConfig | null;
  /** The paired notesd daemon config, null unless a daemon is the active backend. */
  notesdConfig: NotesdConfig | null;
  /**
   * The active-namespace cursor, owned by the orchestrator. It lives up there
   * because the encryption state machine runs before this hook and needs to
   * know which namespace is open (its mode, its passphrase, and so `locked`
   * are per-namespace). Every verb that *moves* the cursor still lives here.
   */
  activeNamespace: string;
  setActiveNamespace: (slug: string) => void;
}

export function useNamespaceRegistry(
  deps: NamespaceRegistryDeps,
): NamespaceRegistry {
  const {
    namespaceStore,
    backend,
    dropboxToken,
    gdriveToken,
    folderHandle,
    nextcloudConfig,
    notesdConfig,
    activeNamespace,
    setActiveNamespace: setActiveNamespaceState,
  } = deps;

  // The namespaces known on this device and which one is active. The list is
  // seeded from localStorage (and reconciled against the backend's
  // `namespaces.json` once a file backend resolves); the active pointer is a
  // per-device cursor selecting which document the adapter reads/writes.
  const [namespaces, setNamespacesState] = useState<Namespace[]>(getNamespaces);

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

  const switchNamespace = useCallback(
    (slug: string) => {
      setActiveNamespaceSlug(slug);
      setActiveNamespaceState(slug);
    },
    [setActiveNamespaceState],
  );

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
    [pushNamespaces, setActiveNamespaceState],
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
          // Fetched here rather than imported: this runs on a delete, long
          // after boot, and the remote backends stay out of the first paint
          // (see `remote-backends.ts`). Already resolved in practice — you
          // cannot be on one of these backends without it having loaded.
          const remote = await import("./remote-backends.ts");
          await remote.deleteDropboxNamespace(dropboxToken, slug);
        } else if (backend === "gdrive" && gdriveToken) {
          const remote = await import("./remote-backends.ts");
          await remote.deleteGdriveNamespace(gdriveToken, slug);
        } else if (backend === "nextcloud" && nextcloudConfig) {
          const remote = await import("./remote-backends.ts");
          await remote.deleteNextcloudNamespace(nextcloudConfig, slug);
        } else if (backend === "notesd" && notesdConfig) {
          const remote = await import("./remote-backends.ts");
          await remote.deleteNotesdNamespace(
            notesdConfig,
            createPinnedFetch(notesdConfig.spkiPin),
            slug,
          );
        }
      } catch (err) {
        log.warn(`removeNamespace: data delete failed for ${slug}`, err);
      }
      registryRemoveNamespace(slug);
      // The namespace's encryption setting is per-namespace device state, so it
      // goes with it — otherwise a later namespace minted with the same slug
      // would inherit a lock over bytes that no longer exist.
      clearEncryption(slug);
      // Same for the session's record that its PIN was entered: a later
      // namespace minted with the same slug must start gated, not open.
      pinsEntered.delete(slug);
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
      nextcloudConfig,
      notesdConfig,
      activeNamespace,
      folderHandle,
      pushNamespaces,
      setActiveNamespaceState,
    ],
  );

  // -- PIN gate -------------------------------------------------------------
  //
  // `pinEpoch` turns the module-level `pinsEntered` set into something React
  // re-renders on; the set itself has to outlive any one component so a
  // namespace stays open across a switch.
  const [pinEpoch, setPinEpoch] = useState(0);

  const namespaceHasPin = useCallback(
    (slug: string): boolean =>
      namespaces.some((n) => n.slug === slug && n.pin !== undefined),
    [namespaces],
  );

  const isNamespacePinLocked = useCallback(
    (slug: string): boolean => {
      void pinEpoch;
      return namespaceHasPin(slug) && !pinsEntered.has(slug);
    },
    [namespaceHasPin, pinEpoch],
  );

  const pinLocked = isNamespacePinLocked(activeNamespace);

  const enterNamespacePin = useCallback(
    async (code: string): Promise<boolean> => {
      const entry = namespaces.find((n) => n.slug === activeNamespace);
      if (!entry?.pin) return true;
      if (!(await verifyNamespacePin(code, entry.pin))) return false;
      pinsEntered.add(activeNamespace);
      setPinEpoch((n) => n + 1);
      unlockAchievement("doorCode");
      return true;
    },
    [namespaces, activeNamespace],
  );

  const setNamespacePin = useCallback(
    async (slug: string, code: string, current?: string): Promise<boolean> => {
      const entry = namespaces.find((n) => n.slug === slug);
      if (!entry) return false;
      if (entry.pin && !(await verifyNamespacePin(current ?? "", entry.pin))) {
        return false;
      }
      registrySetNamespacePin(slug, await createNamespacePin(code));
      // Whoever just set it has plainly proved they know it, so don't turn
      // round and ask for it.
      pinsEntered.add(slug);
      setPinEpoch((n) => n + 1);
      setNamespacesState(getNamespaces());
      pushNamespaces(getNamespaces());
      unlockAchievement("doorCode");
      return true;
    },
    [namespaces, pushNamespaces],
  );

  const clearNamespacePin = useCallback(
    async (slug: string, current: string): Promise<boolean> => {
      const entry = namespaces.find((n) => n.slug === slug);
      if (!entry) return false;
      if (entry.pin && !(await verifyNamespacePin(current, entry.pin))) {
        return false;
      }
      registrySetNamespacePin(slug, null);
      pinsEntered.delete(slug);
      setPinEpoch((n) => n + 1);
      setNamespacesState(getNamespaces());
      pushNamespaces(getNamespaces());
      return true;
    },
    [namespaces, pushNamespaces],
  );

  return {
    namespaces,
    namespaceHasPin,
    isNamespacePinLocked,
    pinLocked,
    enterNamespacePin,
    setNamespacePin,
    clearNamespacePin,
    switchNamespace,
    createNamespace,
    renameNamespace,
    setNamespaceAppearance,
    removeNamespace,
  };
}
