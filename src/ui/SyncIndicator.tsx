import { useMemo, useState } from "react";

import { unlock } from "../achievements/index.ts";
import { noteTitle, type Note } from "../domain/note.ts";
import type { UseStorageBackend } from "../storage/useStorageBackend.ts";
import type { NotesSync } from "../app/use-notes-sync.ts";
import type { EncryptionConversionState } from "./settings/EncryptionLogModal.tsx";
import { lazyModal } from "../app/modals/lazy-modal.tsx";
import { SyncStatus } from "./SyncStatus.tsx";

// The command-centre dialog behind the glyph — a deliberate tap, and one
// only cloud/folder users ever make. Split off; see `lazy-modal.tsx`.
const SyncDetailsModal = lazyModal(() =>
  import("./SyncDetailsModal.tsx").then((m) => m.SyncDetailsModal),
);

// Header cloud-sync affordance for the non-browser backends, ported from
// checklist's header cloud glyph + sync-details modal. Owns the modal's open
// state and derives the provider name / reconnect gesture from the active
// backend, so `SyncStatus` (the morphing glyph button) and `SyncDetailsModal`
// (the command-centre dialog) stay pure presentational pieces. It also resolves
// the ids of the notes uploading right now into titles for the modal's live
// activity list. The browser backend has no remote to sync against, so nothing
// renders for it.

type Props = {
  sync: NotesSync;
  storage: UseStorageBackend;
  /** Notes whose file is being written to the backend this second. */
  uploadingIds: ReadonlySet<string>;
  /** The active document's notes, for resolving upload ids to titles. */
  notes: readonly Note[];
  /** Live snapshot of the background encrypt/decrypt conversion. */
  conversion: EncryptionConversionState;
};

export function SyncIndicator({
  sync,
  storage,
  uploadingIds,
  notes,
  conversion,
}: Props) {
  const [open, setOpen] = useState(false);

  const uploads = useMemo(
    () =>
      notes
        .filter((n) => uploadingIds.has(n.id))
        .map((n) => ({ id: n.id, title: noteTitle(n) })),
    [notes, uploadingIds],
  );

  // The browser backend has no remote to sync against — nothing to show.
  if (storage.backend === "browser") return null;

  // Re-issue the active backend's grant. On the web Dropbox redirects away, so
  // the promise resolves as the page leaves and the boot effect completes the
  // round-trip; on the desktop it runs the loopback flow and rejects on
  // failure, like Drive and the picked folder, so the modal's button can
  // surface it.
  const reconnect = (): Promise<void> => {
    if (storage.backend === "dropbox") return storage.connectDropbox();
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
        encrypted={storage.encryption === "encrypted"}
        uploads={uploads}
        conversion={conversion}
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
