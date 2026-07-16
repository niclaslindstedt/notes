/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Injected by `define` in `vite.config.ts`.
declare const __APP_VERSION__: string;
declare const __BUILD_LABEL__: string;
// True only in the native WebView build (`VITE_TARGET=native`); false on the
// web. Gates paths that assume a service worker / HTTP origin.
declare const __NATIVE__: boolean;

interface ImportMetaEnv {
  // Optional donate link surfaced in the side menu. A blank / unset value
  // hides the entry entirely (set it at build time, e.g. in CI).
  readonly VITE_DONATE_URL?: string;
  // Public Dropbox app key for the Dropbox storage backend's PKCE flow.
  // Unset disables the Dropbox option in the storage picker. Set it at
  // build time (`.env.local` for dev, a CI secret for production).
  readonly VITE_DROPBOX_APP_KEY?: string;
  // Folder name on the Dropbox app registration's "App folder" permission
  // (Dropbox creates `Apps/<this>/`). Unset defaults to `free-notes`; set it
  // to match a fork's own Dropbox app folder.
  readonly VITE_DROPBOX_APP_FOLDER?: string;
  // Public Google OAuth client id for the Google Drive storage backend.
  // Unset disables the Google Drive option in the storage picker.
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
