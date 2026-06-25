import type { Snapshot } from "../../domain/note.ts";
import { useModalState } from "../../ui/modal-bus.ts";
import { SearchModal } from "../../ui/SearchModal.tsx";

// Owns the search modal's open state; opens on a "search" command from the
// modal bus (the side-menu action bar's magnifier). The live document and the
// "open this note" callback come from App as props (like `ConflictModal`),
// since search reaches across the document and the editor selection.
export function SearchModalHost({
  snapshot,
  onOpen,
}: {
  snapshot: Snapshot;
  onOpen: (noteId: string) => void;
}) {
  const { command, close } = useModalState("search");
  return (
    <SearchModal
      open={command !== null}
      onClose={close}
      snapshot={snapshot}
      onOpen={onOpen}
    />
  );
}
