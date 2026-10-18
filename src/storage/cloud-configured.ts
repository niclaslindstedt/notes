// Whether each cloud backend was given its OAuth client id at build time.
//
// Settings asks this to decide whether to *offer* Dropbox at
// all, so it is answered on the app's own path — while the backends
// themselves are fetched only once one is connected (see `remote-backends.ts`).
// Reading the two build-time constants here keeps that question free: a
// `import.meta.env` lookup is inlined by Vite, so nothing of either adapter
// has to load to answer it.

/**
 * Whether this build offers Dropbox at all. False in the phone app's bundle
 * (`VITE_TARGET=native`, see `native/scripts/bundle-web.mjs`): the store
 * build syncs through iCloud Drive and Nextcloud, and has no Dropbox option,
 * mention or key. The website and the desktop app keep it. Vite inlines the
 * comparison, so every branch behind it folds away in the phone build.
 */
export const DROPBOX_IN_BUILD = import.meta.env.VITE_TARGET !== "native";

/**
 * Whether this build offers the local folder at all. False in the phone app's
 * bundle, like Dropbox: its WebView has no directory picker, so the option
 * could only ever sit there greyed out. The storage picker leaves it out (not
 * greyed out), and the privacy page does not describe it. The website and the
 * desktop app keep it, greyed out where the browser can't pick a folder. A
 * phone install with the folder stored as its choice opens on this device's
 * store (`getBackend`).
 */
export const FOLDER_IN_BUILD = import.meta.env.VITE_TARGET !== "native";

/** The Dropbox app key, empty when the build wasn't given one — or offers no Dropbox. */
export const DROPBOX_APP_KEY = DROPBOX_IN_BUILD
  ? (import.meta.env.VITE_DROPBOX_APP_KEY ?? "")
  : "";

export function isDropboxConfigured(): boolean {
  return DROPBOX_APP_KEY.length > 0;
}
