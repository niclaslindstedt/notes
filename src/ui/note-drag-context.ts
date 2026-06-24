// The non-component half of the touch drag-to-folder layer (see
// `note-drag.tsx` for the provider + item components): the drop-target
// contract, the two contexts, and the press-and-hold pointer hook. Split out
// so the `.tsx` file exports only components (React Fast Refresh).
//
// See `note-drag.tsx`'s header for how the gesture works and coexists with
// swipe-to-archive/delete.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

// Drop-target keys carried in the `data-note-drop` attribute. The dragged item
// reads the key under the finger and the provider hands it to `onDrop`, which
// resolves it to an action:
//   - `NOTE_DROP_ROOT`    — the "ungrouped" zone (take the note out of its folder)
//   - `NOTE_DROP_ARCHIVE` — the Archive row (archive the note)
//   - `ns:<slug>`         — a namespace row (move the note to that namespace)
//   - anything else       — a folder id (file the note into that folder)
// The namespace/archive targets live in the side menu only.
export const NOTE_DROP_ROOT = "__root__";
export const NOTE_DROP_ARCHIVE = "__archive__";
export const NOTE_DROP_NS_PREFIX = "ns:";
export const NOTE_DROP_ATTR = "data-note-drop";

/** The drop key for a namespace row, by its slug. */
export function noteDropNamespaceKey(slug: string): string {
  return `${NOTE_DROP_NS_PREFIX}${slug}`;
}

// Hold this long without moving to pick a note up; abort the press if the
// finger travels more than this many px first (it's a scroll or a swipe).
const LONG_PRESS_MS = 320;
const MOVE_SLOP = 10;

export type DragActions = {
  begin: (noteId: string, title: string, x: number, y: number) => void;
  hover: (key: string | null, x: number, y: number) => void;
  commit: () => void;
  cancel: () => void;
};

// Split into two contexts so a draggable item (needs the stable action
// callbacks) never re-renders when the hovered target changes — only the drop
// targets, which read the key, do.
export const ActionsContext = createContext<DragActions | null>(null);
export const DropKeyContext = createContext<string | null>(null);
// A monotonically increasing "abort" signal the app bumps to tear down any
// in-flight drag from outside the gesture — e.g. a sync-conflict modal has
// surfaced over the list and seized the screen. The provider raises it; the
// active row releases its pointer capture and stops blocking scroll, and the
// native HTML5 drop zones drop their lift styling, even though no
// pointerup/cancel (or `dragend`) will arrive on a row the interruption
// unmounted.
export const DragAbortContext = createContext<number>(0);

/** The drop target currently under the finger (its `data-note-drop` value). */
export function useNoteDropKey(): string | null {
  return useContext(DropKeyContext);
}

/** The current drag-abort generation; changes when the app aborts in-flight
 * drags (a sync conflict, a background reload). Native HTML5 drop zones watch
 * it to clear a lift that `dragend` would otherwise never resolve. */
export function useNoteDragAbort(): number {
  return useContext(DragAbortContext);
}

export type TouchDragHandlers = Partial<{
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onClickCapture: (e: ReactMouseEvent) => void;
}>;

// Pointer (touch/pen) long-press drag for one note. Returns handlers to spread
// on the row wrapper and a `dragging` flag for the caller's lift styling. A
// no-op (handlers omitted) when `enabled` is false — the desktop HTML5 path
// owns the gesture there.
export function useTouchNoteDrag(
  noteId: string,
  title: string,
  enabled: boolean,
): { handlers: TouchDragHandlers; dragging: boolean } {
  const actions = useContext(ActionsContext);
  const abortGen = useContext(DragAbortContext);
  const [dragging, setDragging] = useState(false);

  const timer = useRef<number | null>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const active = useRef(false);
  const pointerId = useRef<number | null>(null);
  const targetEl = useRef<HTMLElement | null>(null);
  const justDragged = useRef(false);
  // Non-passive scroll blocker installed only while a drag is live.
  const blockScroll = useRef<(e: TouchEvent) => void>(() => {});

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const hitTest = useCallback(
    (x: number, y: number) => {
      const el = document.elementFromPoint(x, y);
      const target = el?.closest(`[${NOTE_DROP_ATTR}]`);
      actions?.hover(target?.getAttribute(NOTE_DROP_ATTR) ?? null, x, y);
    },
    [actions],
  );

  const cleanup = useCallback(() => {
    clearTimer();
    const el = targetEl.current;
    const id = pointerId.current;
    if (el && id !== null && el.hasPointerCapture?.(id)) {
      try {
        el.releasePointerCapture(id);
      } catch {
        // capture already gone — fine
      }
    }
    document.removeEventListener("touchmove", blockScroll.current);
    active.current = false;
    pointerId.current = null;
    setDragging(false);
  }, [clearTimer]);

  // Tear the gesture down when the app aborts mid-drag (a sync-conflict modal
  // took over, a background reload swapped the list). The row may have
  // unmounted, so no pointerup/cancel will reach these handlers — release the
  // captured pointer and stop blocking scroll here instead, so nothing is left
  // latched. `active` is false on mount and whenever idle, so the initial run
  // (and runs while no drag is live) are no-ops.
  useEffect(() => {
    if (active.current) cleanup();
  }, [abortGen, cleanup]);

  const engage = useCallback(
    (x: number, y: number) => {
      active.current = true;
      setDragging(true);
      const el = targetEl.current;
      if (el && pointerId.current !== null) {
        try {
          el.setPointerCapture(pointerId.current);
        } catch {
          // some browsers reject capture mid-gesture — drag still works
        }
      }
      blockScroll.current = (e: TouchEvent) => e.preventDefault();
      document.addEventListener("touchmove", blockScroll.current, {
        passive: false,
      });
      navigator.vibrate?.(8);
      actions?.begin(noteId, title, x, y);
      hitTest(x, y);
    },
    [actions, hitTest, noteId, title],
  );

  if (!enabled) return { handlers: {}, dragging: false };

  const handlers: TouchDragHandlers = {
    onPointerDown(e) {
      if (e.pointerType === "mouse") return;
      pointerId.current = e.pointerId;
      targetEl.current = e.currentTarget;
      startX.current = e.clientX;
      startY.current = e.clientY;
      active.current = false;
      justDragged.current = false;
      const { clientX: x, clientY: y } = e;
      clearTimer();
      timer.current = window.setTimeout(() => engage(x, y), LONG_PRESS_MS);
    },
    onPointerMove(e) {
      if (pointerId.current !== e.pointerId) return;
      if (!active.current) {
        // Moved before the press latched → it's a scroll or a swipe; stand down.
        if (
          Math.abs(e.clientX - startX.current) > MOVE_SLOP ||
          Math.abs(e.clientY - startY.current) > MOVE_SLOP
        ) {
          clearTimer();
        }
        return;
      }
      e.preventDefault();
      hitTest(e.clientX, e.clientY);
    },
    onPointerUp(e) {
      if (pointerId.current !== e.pointerId) return;
      if (active.current) {
        e.preventDefault();
        justDragged.current = true;
        actions?.commit();
      }
      cleanup();
    },
    onPointerCancel(e) {
      if (pointerId.current !== e.pointerId) return;
      if (active.current) actions?.cancel();
      cleanup();
    },
    // Swallow the click that trails a drag so releasing over a folder files the
    // note instead of also opening it.
    onClickCapture(e) {
      if (justDragged.current) {
        e.preventDefault();
        e.stopPropagation();
        justDragged.current = false;
      }
    },
  };

  return { handlers, dragging };
}
