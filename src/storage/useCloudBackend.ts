// The cloud-OAuth concern of the storage backend, extracted from
// `useStorageBackend` into a self-contained hook: the Dropbox + Google Drive
// access-token state, the four connect / disconnect verbs, and the Dropbox
// boot-redirect completion effect.
//
// Unlike the encryption and folder seams — and like the namespace seam — this
// hook has *no* render-order cycle. It produces the `dropboxToken` /
// `gdriveToken` state the backend selection keys off, but its verbs need
// nothing built *from* that selection: they only switch the active backend
// (via the `selectBackend` callback handed in, which the orchestrator builds
// before this hook runs) and persist token state the hook owns. So it takes
// plain args, not an `activeRef`.
//
// OAuth note: Dropbox uses a full-page redirect — `connectDropbox` navigates
// away and the completion lands back on boot with a `?code=`, handled by the
// effect here. Google Drive uses a popup resolved inline in `connectGdrive`,
// so it never round-trips through the address bar.

import { useCallback, useEffect, useState } from "react";

// Aliased: other storage hooks already import the achievement `unlock`.
import { unlock as unlockAchievement } from "../achievements/index.ts";
import { createLogger } from "../dev/logger.ts";
import {
  type BackendId,
  clearDropboxRefreshToken,
  clearDropboxToken,
  clearGdriveToken,
  getDropboxRefreshToken,
  getDropboxToken,
  getGdriveToken,
  setDropboxRefreshToken,
  setDropboxToken,
  setGdriveToken,
} from "./backend-preference.ts";
import {
  completeDropboxAuth,
  hasPendingDropboxAuth,
  isDropboxConfigured,
  startDropboxAuth,
} from "./dropbox/index.ts";
import { isGdriveConfigured, startGdriveAuth } from "./gdrive/index.ts";

const log = createLogger("storage");

export interface CloudBackend {
  /** The current Dropbox access token, or null when not connected. */
  dropboxToken: string | null;
  /** The current Dropbox refresh token, used to silently renew the access token. */
  dropboxRefresh: string | null;
  /** The current Google Drive access token, or null when not connected. */
  gdriveToken: string | null;
  /** Whether each cloud backend's app key / client id is built in. */
  dropboxConfigured: boolean;
  gdriveConfigured: boolean;
  /** Whether each cloud backend currently holds a usable token. */
  dropboxConnected: boolean;
  gdriveConnected: boolean;
  /**
   * Persist + apply a silently-refreshed Dropbox access token. Wired into the
   * orchestrator's backend-selection `onAccessTokenRefreshed`, which fires when
   * the Dropbox adapter renews an expired access token mid-session.
   */
  applyDropboxAccessToken: (token: string) => void;
  /** Start the Dropbox OAuth redirect; completion lands in the boot effect. */
  connectDropbox: () => void;
  /** Forget the Dropbox tokens and fall back to the browser store. */
  disconnectDropbox: () => void;
  /** Run the Google Drive OAuth popup, store the token, and switch to it. */
  connectGdrive: () => Promise<void>;
  /** Forget the Google Drive token and fall back to the browser store. */
  disconnectGdrive: () => void;
}

// Strip the OAuth redirect's query params (`code`, `state`, `scope`) from the
// address bar without reloading, so a refresh doesn't replay a spent
// authorization code.
function cleanAuthParamsFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    let touched = false;
    for (const key of ["code", "state", "scope"]) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        touched = true;
      }
    }
    if (touched) {
      window.history.replaceState(null, "", url.toString());
    }
  } catch (err) {
    log.warn("failed to clean auth params from URL", err);
  }
}

export function useCloudBackend(
  selectBackend: (id: BackendId) => void,
): CloudBackend {
  const [dropboxToken, setDropboxTokenState] = useState<string | null>(
    getDropboxToken,
  );
  const [dropboxRefresh, setDropboxRefreshState] = useState<string | null>(
    getDropboxRefreshToken,
  );
  const [gdriveToken, setGdriveTokenState] = useState<string | null>(
    getGdriveToken,
  );

  // Complete a Dropbox OAuth redirect on boot. Google Drive uses a popup
  // (resolved inline in `connectGdrive`), so only Dropbox lands back here
  // with a `?code=`.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code || !hasPendingDropboxAuth()) return;
    let cancelled = false;
    void (async () => {
      try {
        log.info("boot: completing Dropbox OAuth redirect");
        const result = await completeDropboxAuth(code);
        if (cancelled) return;
        setDropboxToken(result.accessToken);
        setDropboxTokenState(result.accessToken);
        if (result.refreshToken) {
          setDropboxRefreshToken(result.refreshToken);
          setDropboxRefreshState(result.refreshToken);
        }
        selectBackend("dropbox");
        unlockAchievement("cloudWalker");
      } catch (err) {
        log.error("boot: Dropbox OAuth completion failed", err);
      } finally {
        if (!cancelled) cleanAuthParamsFromUrl();
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once on boot; `selectBackend` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyDropboxAccessToken = useCallback((token: string) => {
    setDropboxToken(token);
    setDropboxTokenState(token);
  }, []);

  const connectDropbox = useCallback(() => {
    // Redirects away; completion runs in the boot effect above — anything
    // queued here wouldn't survive the redirect.
    void startDropboxAuth();
  }, []);

  const disconnectDropbox = useCallback(() => {
    clearDropboxToken();
    clearDropboxRefreshToken();
    setDropboxTokenState(null);
    setDropboxRefreshState(null);
    selectBackend("browser");
  }, [selectBackend]);

  const connectGdrive = useCallback(async () => {
    const token = await startGdriveAuth();
    setGdriveToken(token);
    setGdriveTokenState(token);
    selectBackend("gdrive");
    unlockAchievement("cloudWalker");
  }, [selectBackend]);

  const disconnectGdrive = useCallback(() => {
    clearGdriveToken();
    setGdriveTokenState(null);
    selectBackend("browser");
  }, [selectBackend]);

  return {
    dropboxToken,
    dropboxRefresh,
    gdriveToken,
    dropboxConfigured: isDropboxConfigured(),
    gdriveConfigured: isGdriveConfigured(),
    dropboxConnected: dropboxToken !== null,
    gdriveConnected: gdriveToken !== null,
    applyDropboxAccessToken,
    connectDropbox,
    disconnectDropbox,
    connectGdrive,
    disconnectGdrive,
  };
}
