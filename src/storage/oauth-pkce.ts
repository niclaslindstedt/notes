// Shared OAuth 2.0 PKCE helpers used by every cloud storage adapter that
// signs in through a full-page redirect (Dropbox today; the GIS popup flow
// for Google Drive lives in its own adapter). The helpers are pure and
// stateless; each adapter owns its own `sessionStorage` key for the verifier
// so parallel auth flows don't race each other.

import { createLogger } from "../dev/logger.ts";
import { toBase64Url } from "../encoding/base64url.ts";
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

// Kicks the user out to the provider's consent screen. Returns nothing — the
// next thing that happens is a full-page redirect back to the app with
// `?code=…&state=<config.state>` set.
export async function startAuth(config: OAuthConfig): Promise<void> {
  log.info(
    `${config.providerName}: startAuth (redirect=${redirectUri()}, state=${config.state})`,
  );
  const verifier = randomVerifier();
  sessionStorage.setItem(config.verifierKey, verifier);
  const challenge = await challengeFor(verifier);
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: redirectUri(),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: config.state,
    ...(config.extraAuthParams ?? {}),
  });
  window.location.assign(`${config.authBase}?${params.toString()}`);
}

// Trades the code from the redirect for an access (and, where the provider
// issues one, refresh) token. Caller is responsible for persisting both and
// cleaning the URL. Throws on any failure so the caller can surface it.
export async function completeAuth(
  config: OAuthConfig,
  code: string,
  fetchImpl: FetchImpl = fetch,
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
    redirect_uri: redirectUri(),
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
