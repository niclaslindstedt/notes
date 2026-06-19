import { memo } from "react";

import { noteTitle, notePreview, type Note } from "../domain/note.ts";
import { useT } from "../i18n/index.ts";
import { CloseIcon, RestoreIcon, TrashIcon } from "./icons.tsx";
import { Modal } from "./Modal.tsx";

// The archive view, reached from the side menu. Ported from checklist's
// `ArchiveView` but rendered as one of notes' bus modals rather than a routed
// view. Read-mostly: each archived note carries a Restore button that returns
// it to the overview and a Delete button that removes it for good. Notes only
// enter the archive by being swiped right in the overview. Presentational —
// App owns the notes store and passes the archived list and its actions down.

type Props = {
  open: boolean;
  onClose: () => void;
  /** Archived notes, newest-edited first. */
  notes: Note[];
  /** Bring an archived note back into the overview. */
  onRestore: (id: string) => void;
  /** Remove an archived note permanently (no confirmation — it's undoable). */
  onRemove: (id: string) => void;
};

function ArchiveModalImpl({
  open,
  onClose,
  notes,
  onRestore,
  onRemove,
}: Props) {
  const t = useT();

  return (
    <Modal open={open} onClose={onClose} labelledBy="archive-title">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-surface-3 px-4 py-3">
        <h2
          id="archive-title"
          className="text-sm font-bold tracking-wide text-fg-bright"
        >
          {t("nav.archiveHeading")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="-mr-1 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {notes.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted">
            {t("nav.archiveEmpty")}
          </p>
        ) : (
          <>
            <p className="mb-4 text-xs text-muted">{t("nav.archiveBlurb")}</p>
            <ul className="flex flex-col gap-1">
              {notes.map((note) => (
                <ArchiveRow
                  key={note.id}
                  note={note}
                  onRestore={() => onRestore(note.id)}
                  onDelete={() => onRemove(note.id)}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}

function ArchiveRow({
  note,
  onRestore,
  onDelete,
}: {
  note: Note;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const preview = notePreview(note);
  return (
    <li className="flex items-center gap-2 rounded-[var(--radius)] border border-line bg-surface px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-fg-bright">{noteTitle(note)}</p>
        {preview && (
          <p className="mt-0.5 truncate text-sm text-muted">{preview}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onRestore}
        aria-label={t("nav.restore")}
        title={t("nav.restore")}
        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg-bright"
      >
        <RestoreIcon className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={t("app.delete")}
        title={t("app.delete")}
        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded text-muted hover:bg-danger/10 hover:text-danger"
      >
        <TrashIcon className="h-5 w-5" />
      </button>
    </li>
  );
}

export const ArchiveModal = memo(ArchiveModalImpl);
