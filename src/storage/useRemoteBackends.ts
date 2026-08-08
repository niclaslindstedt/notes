// Loads the remote-backend family (`remote-backends.ts`) when — and only when
// — the active backend preference is something other than this browser's
// `localStorage`.
//
// The load is deliberately allowed to be late. `useBackendSelection` already
// falls through to the browser store whenever the real backend isn't resolved
// yet: a Dropbox token still being read, a folder grant still being probed. On
// those backends the document arrives asynchronously anyway, and the app
// already renders its "first load in flight" state through that window. Waiting
// one more chunk fetch lands inside the same window rather than opening a new
// one, so nothing downstream needs a new not-ready state to handle.
//
// Returns `null` until the module is in hand. Callers must treat that as "not
// this backend yet" rather than "no such backend".

import { useEffect, useState } from "react";

import { createLogger } from "../dev/logger.ts";
import type { BackendId } from "./backend-preference.ts";
import type { RemoteBackends } from "./remote-backends.ts";

const log = createLogger("storage");

// Module-scope so a remount (or a second consumer) reuses the resolved module
// instead of re-entering the loader. The dynamic `import()` itself is cached by
// the module registry; this just keeps the first render after a remount from
// flashing back to `null`.
let loaded: RemoteBackends | null = null;
let inFlight: Promise<RemoteBackends> | null = null;

function loadRemoteBackends(): Promise<RemoteBackends> {
  inFlight ??= import("./remote-backends.ts").then((m) => {
    loaded = m;
    return m;
  });
  return inFlight;
}

export function useRemoteBackends(backend: BackendId): RemoteBackends | null {
  const [remote, setRemote] = useState<RemoteBackends | null>(loaded);

  useEffect(() => {
    if (backend === "browser" || remote) return;
    let cancelled = false;
    void loadRemoteBackends().then(
      (m) => {
        if (!cancelled) setRemote(m);
      },
      (err: unknown) => {
        // A failed chunk fetch (offline on a cold cache, a pruned deploy)
        // leaves `remote` null, which reads downstream as "backend not
        // resolved" — so the app keeps working on the browser store rather
        // than breaking. Worth a log line, since the user picked otherwise.
        inFlight = null;
        log.error("remote backends failed to load", err);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [backend, remote]);

  return remote;
}
