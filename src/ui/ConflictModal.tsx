import { useId } from "react";

import type { NotesSync } from "../app/use-notes-sync.ts";
import { Button } from "./form/Button.tsx";
import { Modal } from "./Modal.tsx";

// Conflict prompt: shown when a save collided with a newer copy on the
// backend (another device edited the same notes). Nothing is merged behind
// the user's back — they pick which copy to keep. Ported from checklist's
// conflict dialog, adapted to the notes document.

type Props = {
  sync: NotesSync;
};

export function ConflictModal({ sync }: Props) {
  const titleId = useId();
  const conflict = sync.conflict;
  if (!conflict) return null;

  const mineCount = sync.doc.notes.length;
  const theirsCount = conflict.remote.notes.length;

  return (
    <Modal
      open
      onClose={() => sync.resolveConflict("remote")}
      labelledBy={titleId}
      role="alertdialog"
      centered
    >
      <div className="flex flex-col gap-3 p-4">
        <h2 id={titleId} className="text-sm font-bold text-fg-bright">
          These notes changed on another device
        </h2>
        <p className="text-xs text-muted">
          Your copy on this device and the copy on the backend have both moved
          on. Keep one — nothing is merged automatically.
        </p>
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            onClick={() => sync.resolveConflict("local")}
          >
            Keep this device&apos;s copy ({mineCount}{" "}
            {mineCount === 1 ? "note" : "notes"})
          </Button>
          <Button
            variant="secondary"
            onClick={() => sync.resolveConflict("remote")}
          >
            Keep the other copy ({theirsCount}{" "}
            {theirsCount === 1 ? "note" : "notes"})
          </Button>
        </div>
      </div>
    </Modal>
  );
}
