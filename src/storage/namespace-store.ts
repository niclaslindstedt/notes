// A root-scoped namespace-registry store: reads and writes the device's
// list of namespaces as a single JSON file at the **app-folder root** — the
// scoped app folder a backend owns (Dropbox's `Apps/<app>/`, Drive's
// `notes/`, the picked local directory). It sits beside `settings.json` and
// the per-namespace folders, so the namespace list travels with the
// synced/shared folder and lands on every device that connects the backend.
//
// This is the namespace-registry counterpart of `settings-store.ts`: the
// list of namespaces (their slugs, display names, and appearance) is an
// app-wide property that should follow the user across devices, not a part
// of any one note document. It stays plaintext JSON even when the documents
// are encrypted — a namespace's name/icon isn't secret, and the list has to
// be readable before the unlock gate can render.
//
// Each file-based backend (local folder, Dropbox, Google Drive) builds one
// over a root-scoped `FileStore` via `fileNamespaceStore`. The browser
// backend has no folders, so it keeps the registry in localStorage and
// exposes no store (the hook keeps the local copy as-is).

import type { FileStore } from "./file-store.ts";

// The registry file's name at the app-folder root. Sits beside
// `settings.json` and the namespace folders, never inside one.
export const NAMESPACES_FILE_NAME = "namespaces.json";

export interface NamespaceRegistryStore {
  /** Read the raw namespaces JSON at the app-folder root, or null when none. */
  load(): Promise<string | null>;
  /** Write the raw namespaces JSON at the app-folder root. */
  save(text: string): Promise<void>;
}

/**
 * Build a namespace-registry store over a `FileStore` rooted at the app
 * folder — one constructed with no namespace, so its relative paths resolve
 * directly under the app-folder root rather than inside a namespace folder.
 * Reads / writes the single `namespaces.json` file there.
 */
export function fileNamespaceStore(
  rootStore: FileStore,
): NamespaceRegistryStore {
  return {
    load: () => rootStore.read(NAMESPACES_FILE_NAME),
    save: async (text) => {
      await rootStore.write(NAMESPACES_FILE_NAME, text);
    },
  };
}
