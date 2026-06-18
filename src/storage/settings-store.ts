// A root-scoped settings store: reads and writes the app's appearance
// settings as a single JSON file at the **app-folder root** — the scoped app
// folder a backend owns (Dropbox's `Apps/<app>/`, Drive's `notes/`, the
// picked local directory). It sits beside the note markdown files, so the
// one settings file travels with the synced/shared folder and lands on every
// device that connects the backend.
//
// This is deliberately separate from the document `StorageAdapter`: settings
// are app-wide device preferences, not part of the note document. They stay
// plaintext JSON even when the notes are encrypted (theme/font choices aren't
// secret, and keeping them readable lets the unlock gate render in the user's
// theme).
//
// Each file-based backend (local folder, Dropbox, Google Drive) builds one
// over a root-scoped `FileStore` via `fileSettingsStore`. The browser
// backend has no folders, so it keeps settings in localStorage and exposes no
// separate store (the appearance store's localStorage cache is its home).

import type { FileStore } from "./file-store.ts";

// The settings file's name at the app-folder root, beside the note `.md`
// files and `notes.json`.
export const SETTINGS_FILE_NAME = "settings.json";

export interface SettingsStore {
  /** Read the raw settings JSON at the app-folder root, or null when none. */
  load(): Promise<string | null>;
  /** Write the raw settings JSON at the app-folder root. */
  save(text: string): Promise<void>;
}

/**
 * Build a settings store over a `FileStore` rooted at the app folder. Reads /
 * writes the single `settings.json` file there.
 */
export function fileSettingsStore(rootStore: FileStore): SettingsStore {
  return {
    load: () => rootStore.read(SETTINGS_FILE_NAME),
    save: (text) => rootStore.write(SETTINGS_FILE_NAME, text),
  };
}
