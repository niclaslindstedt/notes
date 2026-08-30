// Shared OAuth 2.0 PKCE helpers used by every cloud storage adapter that signs
// in through a redirect (Dropbox today; the GIS popup flow for Google Drive
// lives in its own adapter). The helpers are pure and stateless; each adapter
// owns its own `sessionStorage` key for the verifier so parallel auth flows
// don't race each other.
//
// There are **two shapes of the same flow**, differing only in where the
// provider sends the user back to:
//
//   - `startAuth` + `completeAuth` — the web one. The page navigates away to
//     the provider and the provider redirects back to the app's own origin, so
//     completion happens on the next boot (`useCloudBackend`).
//   - `runLoopbackAuth` — the desktop one, per RFC 8252. The app's origin is
//     `notes://app`, which no provider will accept, so the consent screen
//     opens in the user's real browser and the redirect is caught on a
//     loopback listener the Electron shell holds. Nothing navigates, so the
//     whole round trip resolves in one promise.
//
// Everything either shape decides — the challenge, the `state` check, the
// token exchange — lives here. The shell only holds the socket.

import { createLogger } from "../dev/logger.ts";
import { toBase64Url } from "../encoding/base64url.ts";
import {
  awaitLoopbackRedirect,
  beginLoopbackRedirect,
} from "../platform/desktop-bridge.ts";
import { readErrorBody } from "./http-utils.ts";

const log = createLogger("oauth");

// 64 random bytes encoded as base64url — comfortably above the 43-character
// minimum the spec requires and well below the 128-character maximum, so the
// resulting string fits in a URL without truncation.
export function randomVerifier(): string {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export async function challengeFor(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toBase64Url(new Uint8Array(digest));
}

// The OAuth app registration must list this exact URI. We derive it from the
// current page's origin + pathname so production at `/` and preview at
// `/preview/` round-trip back to themselves — without the pathname, the
// redirect from the provider would land the preview build on production,
// where the PKCE verifier (stashed under the preview's sessionStorage key) is
// invisible and auth completion bails.
//
// The trailing slash is trimmed: Google's OAuth client config rejects
// redirect URIs that end in `/`, and Dropbox accepts either form, so the
// slash-less spelling is the only one that satisfies both. `/` maps to the
// bare origin, `/preview/` maps to `<origin>/preview`.
export function redirectUri(): string {
  const pathname = window.location.pathname.replace(/\/+$/, "");
  return `${window.location.origin}${pathname}`;
}

export type FetchImpl = typeof fetch;

// All the per-provider knobs the three flow helpers below need. The helpers
// are uniform across providers; only this record changes.
//
// `extraAuthParams` carries the bits the providers legitimately differ on
// (Dropbox needs `token_access_type=offline`). The helper merges them into
// the redirect's query string verbatim.
//
// `providerName` is the human-readable label that surfaces in thrown error
// messages — "Dropbox token exchange failed: 400" reads better than a generic
// "OAuth token exchange failed".
export type OAuthConfig = {
  authBase: string;
  tokenEndpoint: string;
  clientId: string;
  // OAuth `state` echoed back by the redirect so a multi-provider app can
  // route the `?code=` to the right token exchange.
  state: string;
  // `sessionStorage` key for the PKCE verifier. Per-provider so parallel
  // flows don't race each other on the same slot.
  verifierKey: string;
  providerName: string;
  extraAuthParams?: Record<string, string>;
};

export type TokenResult = {
  accessToken: string;
  refreshToken: string | null;
};

// Builds the authorization URL for one redirect URI. Shared by both flow
// shapes so they cannot drift on what the provider is actually asked for —
// only on where it is told to send the user back.
async function authUrl(
  config: OAuthConfig,
  redirect: string,
  verifier: string,
): Promise<string> {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: redirect,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: "S256",
    state: config.state,
    ...(config.extraAuthParams ?? {}),
  });
  return `${config.authBase}?${params.toString()}`;
}

// Kicks the user out to the provider's consent screen. Returns nothing — the
// next thing that happens is a full-page redirect back to the app with
// `?code=…&state=<config.state>` set.
export async function startAuth(config: OAuthConfig): Promise<void> {
  const redirect = redirectUri();
  log.info(
    `${config.providerName}: startAuth (redirect=${redirect}, state=${config.state})`,
  );
  const verifier = randomVerifier();
  sessionStorage.setItem(config.verifierKey, verifier);
  window.location.assign(await authUrl(config, redirect, verifier));
}

// The whole desktop sign-in, start to tokens, in one promise. Nothing
// navigates: the consent screen opens in the user's own browser (the shell
// turns `window.open` into `shell.openExternal`) and the provider redirects to
// a loopback listener the shell opened for the occasion, so — unlike the web
// flow — there is no boot effect to complete anything afterwards.
//
// Throws on every failure the user can cause as well as the ones they can't:
// declining consent, closing the browser and letting the listener time out, or
// a `state` that doesn't match the one this flow sent. The verifier is dropped
// on all of them so a failed attempt can't be resumed by a later redirect.
export async function runLoopbackAuth(
  config: OAuthConfig,
  fetchImpl: FetchImpl = fetch,
): Promise<TokenResult> {
  const redirect = await beginLoopbackRedirect();
  log.info(`${config.providerName}: loopback auth (redirect=${redirect})`);
  const verifier = randomVerifier();
  sessionStorage.setItem(config.verifierKey, verifier);
  try {
    // `noopener` because this never becomes a window this page talks to — the
    // shell denies the open and hands the URL to the desktop instead.
    window.open(
      await authUrl(config, redirect, verifier),
      "_blank",
      "noopener",
    );
    const params = await awaitLoopbackRedirect();

    const error = params.get("error");
    if (error) {
      throw new Error(
        `${config.providerName} declined the connection: ${
          params.get("error_description") ?? error
        }`,
      );
    }
    // Checked before the code is spent: a `state` that isn't ours means the
    // redirect belongs to some other flow, and the code is not ours to trade.
    if (params.get("state") !== config.state) {
      throw new Error(
        `${config.providerName} redirect carried an unexpected state`,
      );
    }
    const code = params.get("code");
    if (!code) {
      throw new Error(`${config.providerName} redirect carried no code`);
    }
    return await completeAuth(config, code, fetchImpl, redirect);
  } catch (err) {
    sessionStorage.removeItem(config.verifierKey);
    log.error(`${config.providerName}: loopback auth failed`, err);
    throw err;
  }
}

// Trades the code from the redirect for an access (and, where the provider
// issues one, refresh) token. Caller is responsible for persisting both and
// cleaning the URL. Throws on any failure so the caller can surface it.
//
// `redirect` must be the SAME URI the authorization request carried — the
// providers check it again at the token endpoint. It defaults to this origin
// for the web flow; the loopback flow passes the listener's URI, which
// `window.location` knows nothing about.
export async function completeAuth(
  config: OAuthConfig,
  code: string,
  fetchImpl: FetchImpl = fetch,
  redirect: string = redirectUri(),
): Promise<TokenResult> {
  log.info(`${config.providerName}: completeAuth (code received)`);
  const verifier = sessionStorage.getItem(config.verifierKey);
  if (!verifier) {
    log.error(`${config.providerName}: completeAuth — missing PKCE verifier`);
    throw new Error("Missing PKCE verifier — restart the connect flow");
  }
  sessionStorage.removeItem(config.verifierKey);
  const params = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: config.clientId,
    redirect_uri: redirect,
    code_verifier: verifier,
  });
  let res: Response;
  try {
    res = await fetchImpl(config.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  } catch (err) {
    log.error(`${config.providerName}: token exchange network error`, err);
    throw err;
  }
  log.info(`${config.providerName}: token exchange → ${res.status}`);
  if (!res.ok) {
    const body = await readErrorBody(res);
    log.error(`${config.providerName}: token exchange failed`, body);
    throw new Error(
      `${config.providerName} token exchange failed: ${res.status}`,
    );
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!json.access_token) {
    log.error(`${config.providerName}: response missing access_token`);
    throw new Error(
      `${config.providerName} token response missing access_token`,
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
  };
}

// Trades a refresh token for a fresh access token. Returns the new access
// token only — the providers we support (today: Dropbox) keep the refresh
// token stable across calls under the PKCE flow. Throws on any failure so the
// adapter can fall back to surfacing the original 401.
export async function refreshAccessToken(
  config: OAuthConfig,
  refreshToken: string,
  fetchImpl: FetchImpl = fetch,
): Promise<string> {
  log.info(`${config.providerName}: refreshAccessToken`);
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
  });
  let res: Response;
  try {
    res = await fetchImpl(config.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  } catch (err) {
    log.error(`${config.providerName}: refresh network error`, err);
    throw err;
  }
  if (!res.ok) {
    const body = await readErrorBody(res);
    log.error(`${config.providerName}: refresh failed`, body);
    throw new Error(
      `${config.providerName} token refresh failed: ${res.status}`,
    );
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    log.error(`${config.providerName}: refresh response missing access_token`);
    throw new Error(
      `${config.providerName} refresh response missing access_token`,
    );
  }
  return json.access_token;
}
