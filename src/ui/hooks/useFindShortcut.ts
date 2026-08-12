import { useEffect, useRef } from "react";

import { isModalOpen } from "@niclaslindstedt/oss-framework/hooks";

// Takes ⌘F / Ctrl+F away from the browser's "find on page" while a note is open
// and answers it with the note's own find bar instead. The browser's bar
// searches the *rendered* page — it can't be positioned, read, or stepped from
// a phone's keyboard accessory bar, and in the live-preview editor it matches
// what the Markdown renders to rather than what the note says — so the app's
// own bar is the better answer to the keystroke everyone already presses.
//
// Unlike `useSelectAllShortcut` this deliberately does *not* stand down inside
// inputs, textareas, or the editor's contenteditable: the caret sitting in the
// note is the most likely place to press it from, and no field-level "find"
// exists for it to trample. It does stand down while a modal is up, so ⌘F over
// the cross-note search modal (or settings) stays the browser's — the note
// underneath isn't what you're looking at.
export function useFindShortcut(openFind: () => void): void {
  const ref = useRef(openFind);
  ref.current = openFind;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "f") return;
      // Something nearer the keystroke already answered it.
      if (e.defaultPrevented) return;
      if (isModalOpen()) return;
      e.preventDefault();
      ref.current();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
