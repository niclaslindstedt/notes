// Build-time constants injected by `define` in `vite.config.ts`, surfaced
// as a typed module so the rest of the app imports values instead of
// reaching for the global magic identifiers.

/** Semantic version from `package.json` at build time. */
export const APP_VERSION: string = __APP_VERSION__;

/** Human-facing build label (`<version>[.<run>][+<commit>]`). */
export const BUILD_LABEL: string = __BUILD_LABEL__;

/** The app's display name (window title, header wordmark, installed tile). */
export const APP_NAME: string = __APP_NAME__;

/**
 * Whether this is the phone app's bundle (`VITE_TARGET=native`, built by
 * `native/scripts/bundle-web.mjs`). Its privacy page, its Storage settings
 * and its page head describe that app alone, never the website or the desktop
 * app, and it leaves the website's showcase page out. Vite inlines the
 * comparison, so every branch behind it folds away at build time.
 */
export const PHONE_BUILD: boolean = import.meta.env.VITE_TARGET === "native";

/**
 * Whether this build carries What's new — the release history from
 * CHANGELOG.md and the feature docs its Learn more links open. The phone app
 * does not, by owner decision: the App Store's own What's New tells a phone
 * what each update brought. So its side menu has no entry, its app no modal,
 * and its bundle none of that text. The website and the desktop app keep it.
 */
export const CHANGELOG_IN_BUILD: boolean = !PHONE_BUILD;
