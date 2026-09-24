// WHAT THIS COPY OF THE APP CAN DO — one place that answers it.
//
// The app ships to three surfaces: a browser tab (or installed PWA), the
// React Native WebView wrapper in `native/`, and the Tauri window in
// `tauri/`. They are the same bundle, but not every capability exists on
// every one, and the reasons are unrelated to each other:
//
//   - The **folder picker** needs the File System Access API, which is a
//     browser-engine question (Chromium yes, Firefox/Safari no).
//   - **Redirect-based OAuth** needs an origin a provider will accept as a
//     registered redirect URI, which is an `https://` question.
//   - **Loopback OAuth** needs something able to hold a listening socket,
//     which is a wrapper question — and it is how the desktop build gets
//     cloud sync despite failing the one above.
//   - **Auth-session OAuth** needs a host that can open a sign-in sheet and
//     catch a redirect to the app's own URL scheme — the phone wrapper, which
//     loads the page over `file://` and so fails the redirect question too.
//   - **SPKI-pinned fetch** needs native code, which is a wrapper question.
//
// Answering each of them at its own call site is how they drift apart, and it
// already bit once: the desktop build offered no cloud sync, and the reason
// looked like the packaging job not passing `VITE_DROPBOX_APP_KEY` /
// a missing client id when the real reason was that the redirect could never
// land. This module is where that is written down.
//
// **This lives in `src/`, not in a wrapper.** The page works out its own
// surface from what it can observe; no shell tells it anything, and there is
// no bridge message for this. See AGENTS.md, "The wrappers are thin".
//
// One capability is deliberately not here: **iCloud Drive**. It is offered by
// a provider the iOS wrapper installs on `window`, which can in principle land
// after the first render, so it is state rather than a fixed answer — see
// `./icloud-host.ts` and `useICloudBackend`. Like everything here it is asked
// as "is it present?", never "which surface is this?".

import {
  getAuthSessionHost,
  isDesktopShellOrigin,
} from "@niclaslindstedt/oss-framework/storage";

import { isNative } from "./native-bridge.ts";

/** Which of the three surfaces this bundle is running on. */
export type Platform = "web" | "native" | "desktop";

export function platform(): Platform {
  if (isNative()) return "native";
  // The desktop shell is recognised from the origin alone — the `notes:`
  // scheme (`notes://localhost` on macOS and Linux) or the `notes.localhost`
  // host WebView2 maps it onto on Windows. The framework's check is the one
  // its loopback sign-in gates on, so the two can never disagree about where
  // the page is; change the shell's scheme and both follow.
  if (isDesktopShellOrigin()) return "desktop";
  return "web";
}

export interface Capabilities {
  /**
   * The File System Access API directory picker, behind the **Local folder**
   * backend. Chromium-only (Chrome, Edge, Opera, Brave, Arc); Firefox and
   * Safari have no equivalent. In the desktop shell it follows the platform
   * webview: WebView2 on Windows has it, WebKit on macOS and Linux does not.
   */
  folderPicker: boolean;

  /**
   * Whether a redirect-based OAuth flow can complete on this origin.
   *
   * True only in the browser, and not for want of trying elsewhere:
   * `redirectUri()` (`src/storage/oauth-pkce.ts`) is built from
   * `window.location`, so in the desktop shell it is `notes://localhost` (or
   * `http://notes.localhost`), and in the phone wrapper — which loads the
   * embedded bundle over `file://` — a `file:///…/index.html` with a `null`
   * origin. No provider will register either as a redirect URI, so the flow
   * cannot be completed rather than merely being unconfigured.
   */
  redirectOauth: boolean;

  /**
   * Whether an OAuth redirect can instead be caught on a loopback listener —
   * the flow RFC 8252 prescribes for native apps: open the provider in the
   * user's real browser and receive the redirect on `http://127.0.0.1:<port>`
   * rather than on the app's own origin.
   *
   * True only on the desktop, and it is the reason cloud sync exists there at
   * all. It needs something able to hold a listening socket, which a web page
   * is not — the Tauri shell owns it (`tauri/src-tauri/src/loopback.rs`) and
   * the framework's `runLoopbackAuth` reaches it.
   * The browser has `redirectOauth` and the phone wrapper `authSessionOauth`;
   * neither needs this.
   *
   * A provider still has to carry the loopback URIs on its redirect
   * allowlist, so this says the flow *can complete here*, not that every
   * backend is registered for it — see `dropboxAvailable` / `gdriveAvailable`
   * in `src/storage/useStorageBackend.ts` for which ones are.
   */
  loopbackOauth: boolean;

  /**
   * Whether an OAuth redirect can be caught by an authentication session the
   * host offers — `ASWebAuthenticationSession` / a Custom Tab, opened by the
   * phone wrapper, which closes on a redirect to `<bundle id>://oauth` and
   * hands it back (the framework's `runAuthSessionAuth`).
   *
   * Asked as "is the provider there?" (`getAuthSessionHost()`), never as
   * "is this the native wrapper?": the wrapper installs it on `window`
   * before the page's scripts run (`native/src/authSessionBridge.ts`), and a
   * build with no URL scheme installs none — and then offers no Dropbox,
   * rather than a sign-in that opens and never comes back.
   */
  authSessionOauth: boolean;

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
    redirectOauth: surface === "web",
    loopbackOauth: surface === "desktop",
    authSessionOauth: getAuthSessionHost() !== null,
    pinnedFetch: surface === "native",
  };
}
