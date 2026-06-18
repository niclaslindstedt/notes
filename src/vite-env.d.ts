/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Injected by `define` in `vite.config.ts`.
declare const __APP_VERSION__: string;
declare const __BUILD_LABEL__: string;

interface ImportMetaEnv {
  // Optional donate link surfaced in the side menu. A blank / unset value
  // hides the entry entirely (set it at build time, e.g. in CI).
  readonly VITE_DONATE_URL?: string;
  // Public Dropbox app key for the Dropbox storage backend's PKCE flow.
  // Unset disables the Dropbox option in the storage picker. Set it at
  // build time (`.env.local` for dev, a CI secret for production).
  readonly VITE_DROPBOX_APP_KEY?: string;
  // Public Google OAuth client id for the Google Drive storage backend.
  // Unset disables the Google Drive option in the storage picker.
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
