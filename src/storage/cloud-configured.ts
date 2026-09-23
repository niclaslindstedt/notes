// Whether each cloud backend was given its OAuth client id at build time.
//
// Settings asks this to decide whether to *offer* Dropbox at
// all, so it is answered on the app's own path — while the backends
// themselves are fetched only once one is connected (see `remote-backends.ts`).
// Reading the two build-time constants here keeps that question free: a
// `import.meta.env` lookup is inlined by Vite, so nothing of either adapter
// has to load to answer it.

/** The Dropbox app key, empty when the build wasn't given one. */
export const DROPBOX_APP_KEY = import.meta.env.VITE_DROPBOX_APP_KEY ?? "";

export function isDropboxConfigured(): boolean {
  return DROPBOX_APP_KEY.length > 0;
}
