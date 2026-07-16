// The notesd config-plane concern: read and publish the paired-daemon
// discovery list (`notesd.json`) on whichever cloud backend (Dropbox / Google
// Drive) is currently connected, independent of which backend is *active*.
//
// This is what lets a second device find a daemon without re-scanning its QR:
// pair once on any device with a cloud connected and its address + pin are
// published to your own cloud folder; every other device reads them from there
// and pre-fills pairing (it still redeems its own credential — see
// `notesd/config-plane.ts` for why no key is ever published).
//
// It reads the cloud tokens the orchestrator already holds (`useCloudBackend`)
// rather than the active `selection`, because the whole point is to reach the
// cloud config while the *notesd* backend is the active document store.

import { useCallback, useEffect, useState } from "react";

import { createLogger } from "../dev/logger.ts";
import {
  type DropboxAuth,
  createDropboxConfigPlaneStore,
} from "./dropbox/index.ts";
import { createGdriveConfigPlaneStore } from "./gdrive/index.ts";
import {
  type ConfigPlaneStore,
  type PublishedDaemon,
  publishDaemon as publishToStore,
  readPublishedDaemons,
} from "./notesd/config-plane.ts";

const log = createLogger("notesd");

export interface UseNotesdDiscoveryOptions {
  dropboxToken: string | null;
  dropboxRefresh: string | null;
  rememberDropboxAccessToken: (token: string) => void;
  gdriveToken: string | null;
  /** Only read/publish when the self-hosted backend is usable (native). */
  enabled: boolean;
}

export interface NotesdDiscovery {
  /** Daemons found in the connected cloud's `notesd.json`. */
  discoveredDaemons: PublishedDaemon[];
  /** Human name of the cloud discovery reads from, or null when none. */
  discoverySource: "Dropbox" | "Google Drive" | null;
  /** Re-read the config plane (after a pair, or on demand). */
  refreshDiscovery: () => void;
  /** Publish (insert-or-update) a daemon into the connected cloud, if any. */
  publishDaemon: (daemon: PublishedDaemon) => Promise<void>;
}

function resolveStore(
  opts: UseNotesdDiscoveryOptions,
): { store: ConfigPlaneStore; source: "Dropbox" | "Google Drive" } | null {
  if (opts.dropboxToken) {
    const auth: DropboxAuth = {
      accessToken: opts.dropboxToken,
      refreshToken: opts.dropboxRefresh,
      onAccessTokenRefreshed: opts.rememberDropboxAccessToken,
    };
    return { store: createDropboxConfigPlaneStore(auth), source: "Dropbox" };
  }
  if (opts.gdriveToken) {
    return {
      store: createGdriveConfigPlaneStore(opts.gdriveToken),
      source: "Google Drive",
    };
  }
  return null;
}

export function useNotesdDiscovery(
  opts: UseNotesdDiscoveryOptions,
): NotesdDiscovery {
  const { enabled, dropboxToken, gdriveToken } = opts;
  const [discoveredDaemons, setDiscovered] = useState<PublishedDaemon[]>([]);
  const [nonce, setNonce] = useState(0);

  const resolved = enabled ? resolveStore(opts) : null;
  const source = resolved?.source ?? null;

  const refreshDiscovery = useCallback(() => setNonce((n) => n + 1), []);

  // Read the config plane when a cloud is connected. Keyed on the token values
  // (not the freshly-built store object) so it doesn't loop every render.
  useEffect(() => {
    if (!enabled) {
      setDiscovered([]);
      return;
    }
    const built = resolveStore(opts);
    if (!built) {
      setDiscovered([]);
      return;
    }
    let cancelled = false;
    void readPublishedDaemons(built.store)
      .then((list) => {
        if (!cancelled) setDiscovered(list);
      })
      .catch((err) => {
        log.warn("reading config plane failed", err);
        if (!cancelled) setDiscovered([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, dropboxToken, gdriveToken, nonce]);

  const publishDaemon = useCallback(
    async (daemon: PublishedDaemon) => {
      const built = resolveStore(opts);
      if (!built) return; // no cloud connected — nothing to publish to
      try {
        await publishToStore(built.store, daemon);
        refreshDiscovery();
        log.info(`published ${daemon.name} to ${built.source}`);
      } catch (err) {
        // Publishing is a convenience; a failure must not sink the pairing.
        log.warn("publishing to config plane failed", err);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dropboxToken, gdriveToken, refreshDiscovery],
  );

  return {
    discoveredDaemons,
    discoverySource: source,
    refreshDiscovery,
    publishDaemon,
  };
}
