// The iCloud Drive backend concern: whether a host offers it, whether the
// container is usable, and the connect / disconnect verbs. A sibling of
// `useNextcloudBackend`, but with nothing to store: there is no token and no
// server address — the container belongs to the app, and the device's own
// Apple Account decides whether it can be reached.
//
// Two things need tracking that none of the other backends need:
//
//   • WHETHER A HOST IS THERE AT ALL. It arrives from outside the bundle (see
//     `../platform/icloud-host.ts`) — the iOS app installs it, nothing else
//     does — so it is state, not a constant. The page asks whether the
//     capability is present, never where it is running.
//   • WHETHER THE CONTAINER IS USABLE. Unlike an OAuth token, which is either
//     in hand or not, an iCloud container is present in the build and still
//     unreachable when the device is not signed in to iCloud — and the user
//     can fix that from the iOS Settings app without restarting this one. So
//     the status is probed on mount and re-probed on demand, and `signed-out`
//     is a state the settings panel and the sync details can offer to re-check
//     rather than a dead end.
//
// Nothing here reads or writes a file. The stores are built in
// `icloud/index.ts`, behind the remote-backend split (`remote-backends.ts`);
// this module only decides whether they may be.

import { useCallback, useEffect, useState } from "react";

import { unlock as unlockAchievement } from "../achievements/index.ts";
import { createLogger } from "../dev/logger.ts";
import {
  type ICloudHost,
  type ICloudStatus,
  parseICloudStatus,
  useICloudHost,
} from "../platform/icloud-host.ts";
import type { BackendId } from "./backend-preference.ts";

const log = createLogger("icloud");

export interface UseICloudBackendOptions {
  /** Persist + activate a backend (iCloud on connect, browser on disconnect). */
  selectBackend: (id: BackendId) => void;
}

export interface ICloudBackend {
  /** The installed host, or null where none is offered (every browser). */
  icloudHost: ICloudHost | null;
  /**
   * Whether the container is usable. `unavailable` until the first probe has
   * answered, so a backend that turns out not to exist is never briefly
   * offered and then withdrawn.
   */
  icloudStatus: ICloudStatus;
  /**
   * Switch to iCloud Drive. Re-probes first — the user may have signed in to
   * iCloud since the last answer — and rejects, with a message the settings
   * panel shows, when the container still can't be reached.
   */
  connectICloud: () => Promise<void>;
  /** Fall back to the browser store. The files stay in iCloud Drive. */
  disconnectICloud: () => void;
  /** Re-ask the host, and return the fresh answer. */
  refreshICloud: () => Promise<ICloudStatus>;
}

export function useICloudBackend({
  selectBackend,
}: UseICloudBackendOptions): ICloudBackend {
  const host = useICloudHost();
  const [status, setStatus] = useState<ICloudStatus>("unavailable");

  const probe = useCallback(
    async (current: ICloudHost | null): Promise<ICloudStatus> => {
      if (!current) return "unavailable";
      try {
        return parseICloudStatus(await current.status());
      } catch (err) {
        // A host that throws on the cheapest call it has is not one to build a
        // backend on. Treated as signed-out rather than unavailable so the user
        // can still re-check it.
        log.warn("status probe failed", err);
        return "signed-out";
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const answer = await probe(host);
      if (cancelled) return;
      setStatus(answer);
      if (host) log.info(`status: ${answer}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [host, probe]);

  const refreshICloud = useCallback(async () => {
    const answer = await probe(host);
    setStatus(answer);
    log.info(`status: re-probed — ${answer}`);
    return answer;
  }, [host, probe]);

  const connectICloud = useCallback(async () => {
    const answer = await refreshICloud();
    if (answer !== "ready") {
      throw new Error(
        "iCloud Drive isn't available on this device. Sign in to iCloud and " +
          "turn on iCloud Drive in the Settings app, then try again.",
      );
    }
    selectBackend("icloud");
    unlockAchievement("cloudWalker");
    log.info("connected");
  }, [refreshICloud, selectBackend]);

  const disconnectICloud = useCallback(() => {
    selectBackend("browser");
  }, [selectBackend]);

  return {
    icloudHost: host,
    icloudStatus: status,
    connectICloud,
    disconnectICloud,
    refreshICloud,
  };
}
