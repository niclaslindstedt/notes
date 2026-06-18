/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Injected by `define` in `vite.config.ts`.
declare const __APP_VERSION__: string;
declare const __BUILD_LABEL__: string;

interface ImportMetaEnv {
  // Optional donate link surfaced in the side menu. A blank / unset value
  // hides the entry entirely (set it at build time, e.g. in CI).
  readonly VITE_DONATE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
