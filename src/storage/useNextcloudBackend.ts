// The Nextcloud backend concern: the stored connection and the connect /
// disconnect verbs. A sibling of `useCloudBackend`, but there is no OAuth to
// run — a Nextcloud is the user's own server, so connecting is "here is my
// server, my login name, and an app password", checked once against the
// account's WebDAV root before it is stored.
//
// The check matters more than it would for an OAuth backend: the two things
// that go wrong (a rejected app password, a server that won't answer this
// origin cross-origin) are both *setup* problems, and without a connect-time
// probe the first sign of either would be a silent "offline" some seconds
// later, on a backend the user believes is connected.
//
// Like the other verbs that run on a gesture, the adapter module itself is
// imported inside the callback rather than at the top, so Nextcloud stays out
// of the first paint (see `remote-backends.ts`).

import { useCallback, useState } from "react";

import { unlock as unlockAchievement } from "../achievements/index.ts";
import { createLogger } from "../dev/logger.ts";
import {
  type BackendId,
  type NextcloudConfig,
  clearNextcloudConfig,
  getNextcloudConfig,
  setNextcloudConfig,
} from "./backend-preference.ts";

const log = createLogger("nextcloud");

/** What the connect form collects, before normalisation. */
export type NextcloudConnectRequest = {
  /** The server address as typed — a bare host is fine, `https://` is added. */
  server: string;
  username: string;
  appPassword: string;
  /** App-folder path at the account root. Empty falls back to the default. */
  folder?: string;
};

export interface UseNextcloudBackendOptions {
  /** Persist + activate a backend (Nextcloud on connect, browser on disconnect). */
  selectBackend: (id: BackendId) => void;
}

export interface NextcloudBackend {
  /** The stored connection, or null when none is set up. */
  nextcloudConfig: NextcloudConfig | null;
  /**
   * Verify a connection and switch to it. Rejects — with a message the form
   * shows — when the address is malformed, the credentials are refused, or the
   * server can't be reached from this origin.
   */
  connectNextcloud: (request: NextcloudConnectRequest) => Promise<void>;
  /** Forget the connection and fall back to the browser store. */
  disconnectNextcloud: () => void;
}

export function useNextcloudBackend({
  selectBackend,
}: UseNextcloudBackendOptions): NextcloudBackend {
  const [nextcloudConfig, setNextcloudConfigState] =
    useState<NextcloudConfig | null>(getNextcloudConfig);

  const connectNextcloud = useCallback(
    async (request: NextcloudConnectRequest) => {
      const m = await import("./nextcloud/index.ts");
      const config: NextcloudConfig = {
        endpoint: m.normalizeServerUrl(request.server),
        username: request.username.trim(),
        appPassword: request.appPassword.trim(),
        folder:
          m.normalizeFolder(request.folder ?? "") || m.DEFAULT_NEXTCLOUD_FOLDER,
      };
      if (!config.username || !config.appPassword) {
        throw new Error("Enter your Nextcloud user name and app password.");
      }
      await m.verifyNextcloudConnection(config);
      setNextcloudConfig(config);
      setNextcloudConfigState(config);
      selectBackend("nextcloud");
      unlockAchievement("homeCloud");
      log.info(`connected to ${config.endpoint} as ${config.username}`);
    },
    [selectBackend],
  );

  const disconnectNextcloud = useCallback(() => {
    clearNextcloudConfig();
    setNextcloudConfigState(null);
    selectBackend("browser");
  }, [selectBackend]);

  return { nextcloudConfig, connectNextcloud, disconnectNextcloud };
}
