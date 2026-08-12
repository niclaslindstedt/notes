import { flushSync } from "react-dom";

import type { Snapshot } from "../../domain/note.ts";
import { useSearchShortcut } from "../../ui/hooks/useFindShortcuts.ts";
import { useModalDispatch, useModalState } from "../../ui/modal-bus.ts";
import { SearchModal } from "../../ui/SearchModal.tsx";

// Owns the search modal's open state; opens on a "search" command from the
// modal bus (the side-menu action bar's magnifier) and on ⌘⇧F / Ctrl+Shift+F,
// which it binds itself. The keyboard route lives here rather than in the side
// menu because the shortcut answers from anywhere — the list, a note, the
// archive — and this host is mounted the whole time the app is. The live
// document and the "open this note" callback come from App as props (like
// `ConflictModal`), since search reaches across the document and the editor
// selection.
export function SearchModalHost({
  snapshot,
  onOpen,
}: {
  snapshot: Snapshot;
  onOpen: (noteId: string) => void;
}) {
  const { command, close } = useModalState("search");
  const dispatch = useModalDispatch();
  useSearchShortcut(() => {
    // Open synchronously *inside the keystroke* via flushSync, for the same
    // reason the side menu's magnifier does: the search field's focus is a
    // layout effect, and only a focus within the gesture raises the soft
    // keyboard on iOS (where the shortcut is reachable from an attached
    // keyboard).
    flushSync(() => dispatch({ kind: "search" }));
  });
  return (
    <SearchModal
      open={command !== null}
      onClose={close}
      snapshot={snapshot}
      onOpen={onOpen}
    />
  );
}
