// WHAT THE WRAPPER DOES WITH A SIGN-IN REQUEST FROM THE PAGE.
//
// The page asks (see `authSessionBridge.ts`); this opens the provider's
// consent page in an authentication session — `ASWebAuthenticationSession`
// on iOS, a Custom Tab on Android, both through `expo-web-browser` — and
// reports where it ended.
//
// The sheet closes itself when the provider redirects to the app's scheme,
// and what comes back is the redirect URL, unread: whether it carries a code,
// an error or somebody else's `state` is the page's call, because the page
// holds the PKCE verifier and does the token exchange. Nothing is logged and
// nothing is kept — the URL carries a single-use authorization code.

import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";

import { redirectUriFor, type AuthSessionResult } from "./authSessionBridge";

/**
 * The redirect URI this build claims, from `app.config.js`'s `scheme` (the
 * bundle id) — or null in a build with no scheme, in which case no provider
 * is offered and the page's Dropbox option stays hidden.
 */
export function authRedirectUri(): string | null {
  const scheme = Constants.expoConfig?.scheme;
  const first = Array.isArray(scheme) ? scheme[0] : scheme;
  return typeof first === "string" && first !== ""
    ? redirectUriFor(first)
    : null;
}

/** Open one session and package the outcome. Never throws. */
export async function answerAuthSession(
  url: string,
  redirectUri: string,
): Promise<AuthSessionResult> {
  try {
    const result = await WebBrowser.openAuthSessionAsync(url, redirectUri);
    if (result.type === "success") return { ok: true, value: result.url };
    // `cancel` (the reader closed the sheet) and `dismiss` (it was closed for
    // them) both mean no sign-in — the page treats that as a quiet cancel.
    if (result.type === "cancel" || result.type === "dismiss") {
      return { ok: true, value: null };
    }
    return { ok: false, error: `Sign-in could not open (${result.type}).` };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
