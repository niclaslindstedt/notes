import { ArchiveModal } from "../../ui/ArchiveModal.tsx";
import { useModalState } from "../../ui/modal-bus.ts";
import type { Note } from "../../domain/note.ts";

// Owns the archive dialog's open state; opens on an "archive" command from the
// modal bus. The archived note list and its restore / remove actions come
// from App, which owns the notes store.

export function ArchiveModalHost({
  notes,
  onRestore,
  onRemove,
}: {
  notes: Note[];
  onRestore: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { command, close } = useModalState("archive");
  return (
    <ArchiveModal
      open={command !== null}
      onClose={close}
      notes={notes}
      onRestore={onRestore}
      onRemove={onRemove}
    />
  );
}
