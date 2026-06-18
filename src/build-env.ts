// Build-time constants injected by `define` in `vite.config.ts`, surfaced
// as a typed module so the rest of the app imports values instead of
// reaching for the global magic identifiers.

/** Semantic version from `package.json` at build time. */
export const APP_VERSION: string = __APP_VERSION__;

/** Human-facing build label (`<version>[.<run>][+<commit>]`). */
export const BUILD_LABEL: string = __BUILD_LABEL__;
