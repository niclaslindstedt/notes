// The cloud-backend (Dropbox + Dropbox) OAuth concern, lifted out of
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
import { capabilities } from "../platform/capabilities.ts";
import {
  type BackendId,
  clearDropboxRefreshToken,
  clearDropboxToken,
  getDropboxRefreshToken,
  getDropboxToken,
  setDropboxRefreshToken,
  setDropboxToken,
} from "./backend-preference.ts";
// Only the pending-redirect probe is static — it runs on every boot. The auth
// flows themselves are fetched when a connect actually happens, so the cloud
// backends stay out of the first paint (see `remote-backends.ts`).
import { hasPendingDropboxAuth } from "./dropbox/pending.ts";

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
  /** The Dropbox access token, or null when not connected. */
  /**
   * Persist + remember a silently-refreshed Dropbox access token. Wired into
   * the selection memo's `onAccessTokenRefreshed` so a token the adapter
   * refreshes mid-session lands back in state.
   */
  rememberDropboxAccessToken: (token: string) => void;
  /**
   * Connect Dropbox. Two shapes behind one verb, picked by what the surface
   * can do (`capabilities()`): on the web the page navigates to Dropbox and
   * the promise resolves as it leaves, with completion running in the boot
   * effect after the redirect; on the desktop the whole round trip happens
   * here and the promise rejects with anything that went wrong, so the caller
   * can show it.
   */
  connectDropbox: () => Promise<void>;
  /** Forget the Dropbox tokens and fall back to the browser store. */
  disconnectDropbox: () => void;
  /** Forget the Dropbox token and fall back to the browser store. */
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

  const rememberDropboxAccessToken = useCallback((token: string) => {
    setDropboxToken(token);
    setDropboxTokenState(token);
  }, []);

  // Persist + activate a completed Dropbox grant. Shared by the two flow
  // shapes so a token landing from the boot redirect and one landing from the
  // desktop's loopback listener are stored identically.
  const acceptDropboxTokens = useCallback(
    (result: { accessToken: string; refreshToken: string | null }) => {
      setDropboxToken(result.accessToken);
      setDropboxTokenState(result.accessToken);
      if (result.refreshToken) {
        setDropboxRefreshToken(result.refreshToken);
        setDropboxRefreshState(result.refreshToken);
      }
      selectBackend("dropbox");
      unlockAchievement("cloudWalker");
    },
    [selectBackend],
  );

  // Complete a Dropbox OAuth redirect on boot. Dropbox uses a popup
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
        const { completeDropboxAuth } = await import("./dropbox/index.ts");
        const result = await completeDropboxAuth(code);
        if (cancelled) return;
        acceptDropboxTokens(result);
      } catch (err) {
        log.error("boot: Dropbox OAuth completion failed", err);
      } finally {
        if (!cancelled) cleanAuthParamsFromUrl();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [acceptDropboxTokens]);

  const connectDropbox = useCallback(async () => {
    const m = await import("./dropbox/index.ts");
    if (capabilities().loopbackOauth) {
      // The desktop: Dropbox opens in the user's browser and comes back to a
      // loopback listener, so the tokens land right here (the framework's
      // `runLoopbackAuth`). Rejections propagate — the settings panel shows
      // them, since there is no redirect to explain a silent failure.
      acceptDropboxTokens(await m.connectDropboxLoopback());
      return;
    }
    // The web: redirects away, and completion runs in the boot effect above.
    // Anything queued after this wouldn't survive the navigation.
    await m.startDropboxAuth();
  }, [acceptDropboxTokens]);

  const disconnectDropbox = useCallback(() => {
    clearDropboxToken();
    clearDropboxRefreshToken();
    setDropboxTokenState(null);
    setDropboxRefreshState(null);
    selectBackend("browser");
  }, [selectBackend]);

  return {
    dropboxToken,
    dropboxRefresh,
    rememberDropboxAccessToken,
    connectDropbox,
    disconnectDropbox,
  };
}
