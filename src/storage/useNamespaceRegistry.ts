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
import type { BackendId } from "./backend-preference.ts";
import { deleteDropboxNamespace } from "./dropbox/index.ts";
import { deleteGdriveNamespace } from "./gdrive/index.ts";
import { deleteLocalNamespace } from "./local/index.ts";
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

const log = createLogger("storage");

export interface NamespaceRegistry {
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
}

export function useNamespaceRegistry(
  deps: NamespaceRegistryDeps,
): NamespaceRegistry {
  const { namespaceStore, backend, dropboxToken, gdriveToken, folderHandle } =
    deps;

  // The namespaces known on this device and which one is active. The list is
  // seeded from localStorage (and reconciled against the backend's
  // `namespaces.json` once a file backend resolves); the active pointer is a
  // per-device cursor selecting which document the adapter reads/writes.
  const [namespaces, setNamespacesState] = useState<Namespace[]>(getNamespaces);
  const [activeNamespace, setActiveNamespaceState] = useState<string>(
    getActiveNamespaceSlug,
  );

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
    namespaces,
    activeNamespace,
    switchNamespace,
    createNamespace,
    renameNamespace,
    setNamespaceAppearance,
    removeNamespace,
  };
}
