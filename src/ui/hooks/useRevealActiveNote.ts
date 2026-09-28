import { useEffect, type RefObject } from "react";

import { revealScrollTop } from "../reveal-scroll.ts";
import { NOTE_ROW_ATTR } from "../SideMenuRows.tsx";

// Scrolls the side menu's list so the active note's row is on screen, with the
// row after it showing too (see `revealScrollTop`), whenever the list appears
// or the active note changes while it is showing. A long list otherwise opens
// at its top with the note you are in somewhere below the fold.
//
// Deferred a frame so it measures the list the drawer settles on: the same
// commit that shows the drawer also springs the active note's folder open, and
// the note's row only exists once that re-render has landed. It does not run
// again on anything else — a folder toggled or a row added afterwards leaves
// the scroll where the user put it.
export function useRevealActiveNote(
  scrollRef: RefObject<HTMLElement>,
  activeNoteId: string | null,
  showing: boolean,
  loading: boolean,
): void {
  useEffect(() => {
    if (!showing || !activeNoteId || loading) return;
    const frame = requestAnimationFrame(() => {
      const view = scrollRef.current;
      if (!view) return;
      // The first match: a starred note is listed under Favorites as well, and
      // that is the copy nearer the top of the drawer.
      const row = Array.from(
        view.querySelectorAll<HTMLElement>(`[${NOTE_ROW_ATTR}]`),
      ).find((el) => el.getAttribute(NOTE_ROW_ATTR) === activeNoteId);
      if (!row) return;
      const viewRect = view.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const next = revealScrollTop(
        { top: view.scrollTop, height: view.clientHeight },
        {
          top: rowRect.top - viewRect.top + view.scrollTop,
          height: rowRect.height,
        },
        rowRect.height,
      );
      if (next !== null) view.scrollTop = next;
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollRef, activeNoteId, showing, loading]);
}
