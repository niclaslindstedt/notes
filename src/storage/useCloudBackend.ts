// The cloud-backend (Dropbox + Google Drive) OAuth concern, lifted out of
// `useStorageBackend`: the access / refresh token state, the connect /
// disconnect verbs, and the Dropbox boot-redirect completion. Produces the
// tokens the backend `selection` memo (and the namespace registry) key off.
//
// Unlike the encryption and folder seams, the verbs need nothing the orchestrator
// builds *later* — only `selectBackend`, to switch the active backend — so there
// is no render-order cycle here and no `activeRef`. The orchestrator wires the
// silently-refreshed Dropbox access token back in via `rememberDropboxAccessToken`.

import { useCallback, useEffect, useState } from "react";

// Aliased: the storage layer also has a passphrase `unlock` of its own.
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
  startDropboxAuth,
} from "./dropbox/index.ts";
import { startGdriveAuth } from "./gdrive/index.ts";

const log = createLogger("storage");

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

export interface UseCloudBackendOptions {
  /**
   * Persist + activate a backend in one call. The connect verbs switch to the
   * cloud backend; the disconnect verbs (and a token clear) switch back to the
   * browser store.
   */
  selectBackend: (id: BackendId) => void;
}

export interface CloudBackend {
  /** The Dropbox access token, or null when not connected. */
  dropboxToken: string | null;
  /** The Dropbox refresh token, or null. Threaded into the adapter's auth. */
  dropboxRefresh: string | null;
  /** The Google Drive access token, or null when not connected. */
  gdriveToken: string | null;
  /**
   * Persist + remember a silently-refreshed Dropbox access token. Wired into
   * the selection memo's `onAccessTokenRefreshed` so a token the adapter
   * refreshes mid-session lands back in state.
   */
  rememberDropboxAccessToken: (token: string) => void;
  /** Begin the Dropbox OAuth flow; completion runs in the boot effect. */
  connectDropbox: () => void;
  /** Forget the Dropbox tokens and fall back to the browser store. */
  disconnectDropbox: () => void;
  /** Run the Google Drive OAuth popup and switch to the gdrive backend. */
  connectGdrive: () => Promise<void>;
  /** Forget the Google Drive token and fall back to the browser store. */
  disconnectGdrive: () => void;
}

export function useCloudBackend({
  selectBackend,
}: UseCloudBackendOptions): CloudBackend {
  const [dropboxToken, setDropboxTokenState] = useState<string | null>(
    getDropboxToken,
  );
  const [dropboxRefresh, setDropboxRefreshState] = useState<string | null>(
    getDropboxRefreshToken,
  );
  const [gdriveToken, setGdriveTokenState] = useState<string | null>(
    getGdriveToken,
  );

  const rememberDropboxAccessToken = useCallback((token: string) => {
    setDropboxToken(token);
    setDropboxTokenState(token);
  }, []);

  // Complete a Dropbox OAuth redirect on boot. Google Drive uses a popup
  // (resolved inline in `connectGdrive`), so only Dropbox lands back here
  // with a `?code=`. `selectBackend` is a stable callback, so this still runs
  // once on mount; a re-run would be a no-op since the code is consumed and
  // cleaned from the URL on first completion.
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
  }, [selectBackend]);

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
    rememberDropboxAccessToken,
    connectDropbox,
    disconnectDropbox,
    connectGdrive,
    disconnectGdrive,
  };
}
