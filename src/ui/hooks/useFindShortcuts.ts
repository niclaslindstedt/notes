import { useEffect, useRef } from "react";

import { isModalOpen } from "@niclaslindstedt/oss-framework/hooks";

// The ⌘F family: the two shortcuts that answer "search what I'm looking at",
// taken from the browser and split by Shift the way the app splits searching in
// two.
//
//   ⌘F  / Ctrl+F        — the open note's own find bar
//   ⌘⇧F / Ctrl+Shift+F  — the cross-note search modal
//
// Both cancel the browser's "find on page", which is the wrong tool for either
// job: it searches the *rendered* page — what the Markdown renders to rather
// than what the note says, and only the notes currently on screen — highlights
// it somewhere the app can't read back, and offers nothing to step it with on a
// phone. Shift is the modifier because the two searches are the same question
// asked wider, which is also how editors everywhere spell "search more than
// this file".
//
// Neither stands down inside inputs, textareas, or the editor's contenteditable
// the way `useSelectAllShortcut` does: the caret sitting in a note is the
// likeliest place to press these from, and no field-level "find" exists for
// them to trample. Both *do* stand down while a modal is up, so neither fires
// over the search modal itself or over settings — what's on top is what you're
// looking at, and neither of these searches it.

/** Shared plumbing: a window-level ⌘/Ctrl+F with a fixed Shift state. */
function useFindKey(shift: boolean, run: () => void): void {
  const ref = useRef(run);
  ref.current = run;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.shiftKey !== shift) return;
      if (e.key.toLowerCase() !== "f") return;
      // Something nearer the keystroke already answered it.
      if (e.defaultPrevented) return;
      if (isModalOpen()) return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shift]);
}

/** ⌘F / Ctrl+F — the find bar for the note that is open. */
export function useFindShortcut(openFind: () => void): void {
  useFindKey(false, openFind);
}

/**
 * ⌘⇧F / Ctrl+Shift+F — the cross-note search modal. Mounted app-wide (by
 * `SearchModalHost`) rather than by the editor, because searching every note is
 * a question you can ask from the list just as well as from inside a note.
 */
export function useSearchShortcut(openSearch: () => void): void {
  useFindKey(true, openSearch);
}
