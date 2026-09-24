// THE AUTH-SESSION BRIDGE: how the page signs in to Dropbox from inside the
// app.
//
// The page is loaded from the app bundle over `file://`, and its OAuth
// redirect flow cannot finish there. `redirectUri()` in
// `src/storage/oauth-pkce.ts` is the page's origin plus its path — here a
// `file:///…/web/index.html` no provider will register — and the providers
// refuse to show consent inside an embedded WebView anyway. Sent to Safari
// instead, the consent page would redirect Safari, which does not hold the
// PKCE verifier the page stashed in its own `sessionStorage`.
//
// The platform's own answer is an AUTHENTICATION SESSION
// (`ASWebAuthenticationSession` on iOS, a Custom Tab on Android): a browser
// sheet over the app that closes the moment the provider redirects to a URI
// the app claims — `<bundle id>://oauth` — and hands that URI back. This
// wrapper offers one to the page as a CAPABILITY: `window.__ossAuthSession`,
// the seam the framework's storage module looks for (`getAuthSessionHost` in
// `@niclaslindstedt/oss-framework/storage`). A browser has no such host and
// keeps its redirect flow; the desktop shell has none and keeps its loopback
// one. The page asks whether the capability is there, never where it runs.
//
// The wrapper decides nothing about the sign-in. It opens a URL and hands back
// where the sheet ended: the PKCE challenge, the `state` check and the token
// exchange all stay in the page (the framework's `runAuthSessionAuth`), which
// is also the only place the tokens ever exist.
//
// Same shape as `icloudBridge.ts`: this file exports STRINGS for the page
// (dependency-free, ES5-ish — nothing in them is transpiled) plus the pure
// narrowing and settling helpers. It is exercised from the root test suite
// (`tests/platform/auth-session.test.ts`), so it imports nothing that reaches
// `expo`.

import { escapeForScript } from "./scriptText";

/** The message the page posts to ask for a session. Namespaced like the
 *  iCloud requests, and without the `v` field `bridge/on-message.ts`'s
 *  envelopes carry, so none of them is ever mistaken for another. */
export const AUTH_SESSION_REQUEST_TYPE = "notes-native/auth-session-request";

/** Where the provider installs itself. The FRAMEWORK's name, not this app's
 *  (`AUTH_SESSION_HOST_PROPERTY`): the page-side flow lives in oss-framework,
 *  so a rename here is not an error — it is a Dropbox option that silently
 *  disappears from the phone app. The root test pins the two together. */
export const HOST_PROPERTY = "__ossAuthSession";

/** The event the provider announces itself with (`AUTH_SESSION_HOST_EVENT`). */
export const HOST_EVENT = "oss:auth-session-host";

/** The resolver the settling script calls. App-private, never read by the
 *  framework. */
const RESOLVE_PROPERTY = "__ossAuthSessionResolve";

/** The path under the app's URL scheme that the provider redirects to. */
const REDIRECT_PATH = "oauth";

/**
 * The redirect URI the wrapper catches: `<scheme>://oauth`, where `<scheme>`
 * is `app.config.js`'s `scheme` — the bundle id, so `se.agilator.notes://oauth`
 * in the store build. This exact string is what the Dropbox app's App Console
 * must list under Redirect URIs.
 */
export function redirectUriFor(scheme: string): string {
  return `${scheme}://${REDIRECT_PATH}`;
}

/** What one request asks for: open `url`, report where the sheet ended. */
export type AuthSessionRequest = {
  type: string;
  /** Correlates the answer with the promise waiting for it. */
  id: string;
  /** The provider's authorization URL. */
  url: string;
};

/** The answer. `value` is the URL the provider redirected to, or null when
 *  the reader closed the sheet. A failure crosses as data, because the
 *  channel carries strings; the page-side script turns it back into a thrown
 *  `Error`. */
export type AuthSessionResult =
  { ok: true; value: string | null } | { ok: false; error: string };

/**
 * The script that installs the provider, for the redirect URI this build
 * claims.
 *
 * Injected before the page's own scripts run
 * (`injectedJavaScriptBeforeContentLoaded`, beside the iCloud provider), so
 * the storage picker finds it on its first render. Guarded against a second
 * injection (a reload re-runs it). Nothing times out: a sheet the reader
 * leaves open leaves the sign-in pending, which is what it is.
 */
export function authSessionScript(redirectUri: string): string {
  return `(function () {
  if (window.${HOST_PROPERTY}) return;

  var pending = {};
  var next = 0;

  window.${RESOLVE_PROPERTY} = function (id, result) {
    var entry = pending[id];
    if (!entry) return;
    delete pending[id];
    if (result && result.ok) entry.resolve(result.value === undefined ? null : result.value);
    else entry.reject(new Error((result && result.error) || "Sign-in failed."));
  };

  window.${HOST_PROPERTY} = {
    version: 1,
    redirectUri: ${escapeForScript(redirectUri)},
    open: function (url) {
      return new Promise(function (resolve, reject) {
        var id = "a" + (next += 1);
        pending[id] = { resolve: resolve, reject: reject };
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: ${JSON.stringify(AUTH_SESSION_REQUEST_TYPE)},
            id: id,
            url: String(url)
          }));
        } catch (e) {
          delete pending[id];
          reject(new Error("The sign-in bridge is unavailable."));
        }
      });
    }
  };

  try {
    window.dispatchEvent(new Event(${JSON.stringify(HOST_EVENT)}));
  } catch (e) {}
})(); true;`;
}

/**
 * Narrow an arbitrary parsed `postMessage` body to a session request.
 *
 * Only an `https:` URL is accepted. The sheet is a real browser the reader
 * trusts with a password, and the one thing it is for is a provider's consent
 * page — not a `javascript:` URL, and not a `file:` one dressed up as one.
 */
export function isAuthSessionRequest(
  value: unknown,
): value is AuthSessionRequest {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<AuthSessionRequest>;
  if (message.type !== AUTH_SESSION_REQUEST_TYPE) return false;
  if (typeof message.id !== "string" || message.id === "") return false;
  if (typeof message.url !== "string") return false;
  return /^https:\/\/[^/?#\s]+/i.test(message.url);
}

/** The line of JavaScript that settles one pending request. The answer is
 *  embedded as a JSON string and parsed in the page — the callback URL is
 *  provider-controlled text, and text is what breaks out of a literal. */
export function authSessionResolveScript(
  id: string,
  result: AuthSessionResult,
): string {
  const payload = escapeForScript(JSON.stringify({ id, result }));
  return `(function () {
    try {
      var answer = JSON.parse(${payload});
      if (window.${RESOLVE_PROPERTY}) {
        window.${RESOLVE_PROPERTY}(answer.id, answer.result);
      }
    } catch (e) {}
  })(); true;`;
}
