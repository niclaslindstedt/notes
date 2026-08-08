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
import type { DropboxAuth } from "./dropbox/index.ts";
import type {
  ConfigPlaneStore,
  PublishedDaemon,
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

// Which cloud discovery would read from — answerable from the tokens alone, so
// the render path can label the source without loading a backend.
function resolveSource(
  opts: UseNotesdDiscoveryOptions,
): "Dropbox" | "Google Drive" | null {
  if (opts.dropboxToken) return "Dropbox";
  if (opts.gdriveToken) return "Google Drive";
  return null;
}

// The store itself needs the connected cloud's config-plane code, which is
// fetched on demand with the rest of the remote backends (see
// `remote-backends.ts`) rather than shipped to every user who never connects
// one. Both callers already run inside an effect or an async verb.
async function resolveStore(opts: UseNotesdDiscoveryOptions): Promise<{
  store: ConfigPlaneStore;
  source: "Dropbox" | "Google Drive";
} | null> {
  if (opts.dropboxToken) {
    const auth: DropboxAuth = {
      accessToken: opts.dropboxToken,
      refreshToken: opts.dropboxRefresh,
      onAccessTokenRefreshed: opts.rememberDropboxAccessToken,
    };
    const { createDropboxConfigPlaneStore } =
      await import("./dropbox/index.ts");
    return { store: createDropboxConfigPlaneStore(auth), source: "Dropbox" };
  }
  if (opts.gdriveToken) {
    const { createGdriveConfigPlaneStore } = await import("./gdrive/index.ts");
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

  const source = enabled ? resolveSource(opts) : null;

  const refreshDiscovery = useCallback(() => setNonce((n) => n + 1), []);

  // Read the config plane when a cloud is connected. Keyed on the token values
  // (not the freshly-built store object) so it doesn't loop every render.
  useEffect(() => {
    if (!enabled) {
      setDiscovered([]);
      return;
    }
    let cancelled = false;
    void resolveStore(opts)
      .then(async (built) => {
        if (!built) return [];
        const { readPublishedDaemons } =
          await import("./notesd/config-plane.ts");
        return readPublishedDaemons(built.store);
      })
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
      const built = await resolveStore(opts);
      if (!built) return; // no cloud connected — nothing to publish to
      try {
        const { publishDaemon: publishToStore } =
          await import("./notesd/config-plane.ts");
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
