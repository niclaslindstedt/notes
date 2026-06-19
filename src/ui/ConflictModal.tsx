import { useId } from "react";

import type { NotesSync } from "../app/use-notes-sync.ts";
import type { Snapshot } from "../domain/note.ts";
import { useT } from "../i18n/index.ts";
import { Button } from "./form/Button.tsx";
import { Modal } from "./Modal.tsx";

// Conflict prompt: opens when a save collided with a newer copy on the
// backend (another device edited the same notes while this one was editing).
// The two copies are summarised side by side so the user can pick which one
// wins — nothing is merged automatically. Ported from checklist's
// ConflictResolutionModal, adapted to the notes document.
//
// "Keep this device's copy" re-saves the in-memory bytes basing the write on
// the remote revision so the backend accepts the overwrite. "Keep the other
// copy" swaps in-memory state for the remote bytes without writing back.

type Props = {
  sync: NotesSync;
};

// A coarse measure of each copy's content so the user has something to weigh
// when choosing a side. Notes have no nested structure, so we count the notes
// and the total words across their bodies.
function summarise(doc: Snapshot): { notes: number; words: number } {
  let words = 0;
  for (const note of doc.notes) {
    const trimmed = note.body.trim();
    if (trimmed.length > 0) words += trimmed.split(/\s+/).length;
  }
  return { notes: doc.notes.length, words };
}

export function ConflictModal({ sync }: Props) {
  const t = useT();
  const titleId = useId();
  const conflict = sync.conflict;
  if (!conflict) return null;

  const mine = summarise(sync.doc);
  const theirs = summarise(conflict.remote);

  // No plural engine: pick the One vs Other string by count. The two counts
  // join into a single per-copy summary line.
  const noteCount = (n: number) =>
    t(n === 1 ? "sync.conflict.notesOne" : "sync.conflict.notesOther", { n });
  const wordCount = (n: number) =>
    t(n === 1 ? "sync.conflict.wordsOne" : "sync.conflict.wordsOther", { n });
  const counts = (s: { notes: number; words: number }) =>
    `${noteCount(s.notes)}, ${wordCount(s.words)}`;

  return (
    <Modal
      open
      // Non-dismissable: the two copies can't coexist, so the user has to
      // pick a side. Backdrop click and Escape are deliberately no-ops.
      onClose={() => {}}
      labelledBy={titleId}
      role="alertdialog"
    >
      <header className="flex shrink-0 items-center border-b border-line bg-surface-3 px-4 py-3">
        <h2
          id={titleId}
          className="text-sm font-bold tracking-wide text-fg-bright"
        >
          {t("sync.conflict.title")}
        </h2>
      </header>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        <p className="text-sm text-fg">{t("sync.conflict.hint")}</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded border border-line bg-surface-2 px-3 py-2">
            <div className="text-xs font-bold text-fg-bright">
              {t("sync.conflict.mineLabel")}
            </div>
            <div className="mt-1 text-xs text-muted">{counts(mine)}</div>
          </div>
          <div className="rounded border border-line bg-surface-2 px-3 py-2">
            <div className="text-xs font-bold text-fg-bright">
              {t("sync.conflict.theirsLabel")}
            </div>
            <div className="mt-1 text-xs text-muted">{counts(theirs)}</div>
          </div>
        </div>
      </div>
      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface-3 px-4 py-3">
        <Button
          variant="secondary"
          onClick={() => sync.resolveConflict("remote")}
        >
          {t("sync.conflict.keepTheirs")}
        </Button>
        <Button variant="primary" onClick={() => sync.resolveConflict("local")}>
          {t("sync.conflict.keepMine")}
        </Button>
      </footer>
    </Modal>
  );
}
