// A namespace-scoped settings store: reads and writes one namespace's slice of
// the appearance settings as a single JSON file **inside that namespace's own
// folder** — `namespace-settings.json` beside the namespace's `notes/` and
// `attachments/` subfolders (at the app-folder root for the default namespace,
// where its data already lives).
//
// This is the middle width of the three the appearance store stacks (see
// `src/theme/appearance-scopes.ts`). The root `settings.json` that
// `settings-store.ts` owns is account-wide; this one belongs to the people
// who share *this* namespace and nobody else. Putting it in the namespace
// folder is the whole point: a namespace folder shared wholesale — the
// `family/` folder handed to relatives — carries the settings that namespace's
// users agreed on along with its notes.
//
// Like the root settings file it holds plaintext JSON even when the notes are
// encrypted (theme and font choices aren't secret, and the unlock gate has to
// render in the right theme before any passphrase is held), and it is a
// **sparse** document: only the settings that namespace actually has an
// opinion about. Everything else keeps falling through to the global layer.

import type { FileStore } from "./file-store.ts";

// The file's name inside the namespace folder. Deliberately not
// `settings.json`: the default namespace owns the app-folder root, where that
// name is already taken by the account-wide file.
export const NAMESPACE_SETTINGS_FILE_NAME = "namespace-settings.json";

export interface NamespaceSettingsStore {
  /** Read the raw namespace settings JSON, or null when none. */
  load(): Promise<string | null>;
  /** Write the raw namespace settings JSON. */
  save(text: string): Promise<void>;
}

/**
 * Build a namespace settings store over a `FileStore` rooted at the
 * **namespace folder** — for the default namespace that is the app-folder
 * root, for every other one the `<slug>/` folder.
 */
export function fileNamespaceSettingsStore(
  namespaceRootStore: FileStore,
): NamespaceSettingsStore {
  return {
    load: () => namespaceRootStore.read(NAMESPACE_SETTINGS_FILE_NAME),
    save: async (text) => {
      await namespaceRootStore.write(NAMESPACE_SETTINGS_FILE_NAME, text);
    },
  };
}
