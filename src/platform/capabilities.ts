// WHAT THIS COPY OF THE APP CAN DO — one place that answers it.
//
// The app ships to three surfaces: a browser tab (or installed PWA), the
// React Native WebView wrapper in `native/`, and the Electron window in
// `electron/`. They are the same bundle, but not every capability exists on
// every one, and the reasons are unrelated to each other:
//
//   - The **folder picker** needs the File System Access API, which is a
//     browser-engine question (Chromium yes, Firefox/Safari no).
//   - **Redirect-based OAuth** needs an origin a provider will accept as a
//     registered redirect URI, which is an `https://` question.
//   - **SPKI-pinned fetch** needs native code, which is a wrapper question.
//
// Answering each of them at its own call site is how they drift apart, and it
// already bit once: the desktop build offers no cloud sync today only because
// the packaging job happens not to pass `VITE_DROPBOX_APP_KEY` /
// `VITE_GOOGLE_CLIENT_ID`. Add those secrets to that job and both options
// light up and then fail at the redirect — the real reason they cannot work
// there was written down nowhere. This module is where it is written down.
//
// **This lives in `src/`, not in a wrapper.** The page works out its own
// surface from what it can observe; no shell tells it anything, and there is
// no bridge message for this. See AGENTS.md, "The wrappers are thin".

import { isNative } from "./native-bridge.ts";

/** Which of the three surfaces this bundle is running on. */
export type Platform = "web" | "native" | "desktop";

/**
 * The private scheme the Electron shell serves the app from
 * (`electron/main.js`). It is the one thing about that surface the page can
 * see from the inside, and it is deliberately the same constant on both
 * sides — change one and the desktop build silently reverts to answering
 * "web", which is what would put the unusable cloud options back.
 */
const DESKTOP_PROTOCOL = "notes:";

export function platform(): Platform {
  if (isNative()) return "native";
  if (
    typeof window !== "undefined" &&
    window.location?.protocol === DESKTOP_PROTOCOL
  ) {
    return "desktop";
  }
  return "web";
}

export interface Capabilities {
  /**
   * The File System Access API directory picker, behind the **Local folder**
   * backend. Chromium-only (Chrome, Edge, Opera, Brave, Arc); Firefox and
   * Safari have no equivalent. True in both wrappers, which are Chromium.
   */
  folderPicker: boolean;

  /**
   * Whether a redirect-based OAuth flow can complete on this origin — the
   * gate on both cloud backends.
   *
   * False on the desktop, and not for want of trying: `redirectUri()`
   * (`src/storage/oauth-pkce.ts`) is built from `window.location`, so on the
   * Electron shell it is `notes://app`. No provider will register a custom
   * scheme as a redirect URI, and Google rejects non-`https` outright, so the
   * flow cannot be completed rather than merely being unconfigured. The
   * browser and the WebView wrapper both have a real `https://` origin.
   */
  redirectOauth: boolean;

  /**
   * SPKI-pinned HTTPS, behind the self-hosted **notesd** backend. Needs native
   * code to pin a certificate a browser would refuse, so it exists only in the
   * React Native wrapper — see `pinnedFetch` in `./native-bridge.ts`.
   */
  pinnedFetch: boolean;
}

export function capabilities(): Capabilities {
  const surface = platform();
  return {
    folderPicker:
      typeof window !== "undefined" && "showDirectoryPicker" in window,
    redirectOauth: surface !== "desktop",
    pinnedFetch: surface === "native",
  };
}
