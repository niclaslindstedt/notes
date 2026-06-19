import { useState } from "react";

import { unlock } from "../achievements/index.ts";
import type { UseStorageBackend } from "../storage/useStorageBackend.ts";
import type { NotesSync } from "../app/use-notes-sync.ts";
import { SyncDetailsModal } from "./SyncDetailsModal.tsx";
import { SyncStatus } from "./SyncStatus.tsx";

// Header cloud-sync affordance for the non-browser backends, ported from
// checklist's header cloud glyph + sync-details modal. Owns the modal's open
// state and derives the provider name / reconnect gesture from the active
// backend, so `SyncStatus` (the morphing glyph button) and `SyncDetailsModal`
// (the info dialog) stay pure presentational pieces. The browser backend has
// no remote to sync against, so nothing renders for it.

type Props = {
  sync: NotesSync;
  storage: UseStorageBackend;
};

export function SyncIndicator({ sync, storage }: Props) {
  const [open, setOpen] = useState(false);

  // The browser backend has no remote to sync against — nothing to show.
  if (storage.backend === "browser") return null;

  // Re-issue the active backend's grant. Dropbox redirects away (so the
  // returned promise never really resolves — the boot effect completes the
  // round-trip); Drive and the picked folder re-grant inline and reject on
  // failure so the modal's button can surface it.
  const reconnect = (): Promise<void> => {
    if (storage.backend === "dropbox") {
      storage.connectDropbox();
      return Promise.resolve();
    }
    if (storage.backend === "gdrive") return storage.connectGdrive();
    return storage.reconnectFolder();
  };

  return (
    <>
      <SyncStatus
        providerName={storage.adapter.label}
        status={sync.status}
        dirty={sync.dirty}
        offline={sync.offline}
        onSave={sync.saveNow}
        onOpenDetails={() => setOpen(true)}
      />
      <SyncDetailsModal
        open={open}
        backend={storage.backend}
        namespace={storage.activeNamespace}
        providerName={storage.adapter.label}
        status={sync.status}
        statusDetail={sync.statusDetail}
        dirty={sync.dirty}
        offline={sync.offline}
        onSaveNow={sync.saveNow}
        onReload={() => {
          unlock("freshPull");
          void sync.reload();
        }}
        onReconnect={reconnect}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
