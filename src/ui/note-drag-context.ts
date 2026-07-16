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

import { haptics } from "../platform/native-bridge.ts";

// Drop-target keys carried in the `data-note-drop` attribute. The dragged item
// reads the key under the finger and the provider hands it to `onDrop`, which
// resolves it to an action:
//   - `NOTE_DROP_ROOT`    — the "ungrouped" zone (take the note out of its folder)
//   - `NOTE_DROP_ARCHIVE` — the Archive row (archive the note)
//   - `ns:<slug>`         — a namespace row (move the dragged item to that namespace)
//   - anything else       — a folder id (file the note into that folder)
// The namespace/archive targets live in the side menu only. A dragged item is
// either a single **note** or a whole **folder** (`DragItem.kind`); a folder
// only resolves against a namespace target — it's moved there with all the
// notes filed in it.
export const NOTE_DROP_ROOT = "__root__";
export const NOTE_DROP_ARCHIVE = "__archive__";
export const NOTE_DROP_NS_PREFIX = "ns:";
export const NOTE_DROP_ATTR = "data-note-drop";

/** The drop key for a namespace row, by its slug. */
export function noteDropNamespaceKey(slug: string): string {
  return `${NOTE_DROP_NS_PREFIX}${slug}`;
}

/** What the user picked up: a single note, or a whole folder (move-all). */
export type DragKind = "note" | "folder";

/** The thing being dragged — a note or a folder — plus the label the ghost shows. */
export type DragItem = { kind: DragKind; id: string; title: string };

// Hold this long without moving to pick a note up; abort the press if the
// finger travels more than this many px first (it's a scroll or a swipe).
const LONG_PRESS_MS = 320;
const MOVE_SLOP = 10;

export type DragActions = {
  begin: (item: DragItem, x: number, y: number) => void;
  hover: (key: string | null, x: number, y: number) => void;
  commit: () => void;
  cancel: () => void;
};

// Split into two contexts so a draggable item (needs the stable action
// callbacks) never re-renders when the hovered target changes — only the drop
// targets, which read the key, do.
export const ActionsContext = createContext<DragActions | null>(null);
export const DropKeyContext = createContext<string | null>(null);
// The kind of the item currently lifted (or null when nothing is). Drop targets
// read it so a notes-only target (a folder, the root zone, the Archive row)
// doesn't paint a highlight while a *folder* is being dragged over it — only
// namespace rows accept a folder.
export const DragKindContext = createContext<DragKind | null>(null);
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

/** The kind of item being touch-dragged right now (or null when idle). */
export function useNoteDragKind(): DragKind | null {
  return useContext(DragKindContext);
}

/** The current drag-abort generation; changes when the app aborts in-flight
 * drags (a sync conflict, a background reload). Native HTML5 drop zones watch
 * it to clear a lift that `dragend` would otherwise never resolve. */
export function useNoteDragAbort(): number {
  return useContext(DragAbortContext);
}

export type TouchDragHandlers = Partial<{
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onClickCapture: (e: ReactMouseEvent) => void;
}>;

// Pointer (touch/pen) long-press drag for one item (a note or a folder).
// Returns handlers to spread on the row wrapper and a `dragging` flag for the
// caller's lift styling. A no-op (handlers omitted) when `enabled` is false —
// the desktop HTML5 path owns the gesture there.
export function useTouchNoteDrag(
  id: string,
  title: string,
  kind: DragKind,
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
  // Detaches the window move/up/cancel listeners bound for the lifetime of the
  // active gesture (see `bindWindow`). Held on a ref so `cleanup` can drop them
  // without depending on the handler identities.
  const detachWindow = useRef<(() => void) | null>(null);

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
    detachWindow.current?.();
    detachWindow.current = null;
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
  // took over, a background reload swapped the list). The user is still
  // holding — no pointerup has fired — so `cleanup` here drops the chip and
  // detaches the window listeners now, both so the lifted note doesn't hover
  // over the modal and so a later release can't commit a move into the
  // unresolved conflict. `active` is false on mount and whenever idle, so the
  // initial run (and runs while no drag is live) are no-ops.
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
          // Capture is best-effort — it keeps touch events on the row and
          // suppresses text selection — but correctness no longer depends on
          // it: move/up/cancel live on `window`, so a release is caught
          // wherever the pointer ends up even when capture is refused.
        }
      }
      blockScroll.current = (e: TouchEvent) => e.preventDefault();
      document.addEventListener("touchmove", blockScroll.current, {
        passive: false,
      });
      haptics.vibrate(8);
      actions?.begin({ kind, id, title }, x, y);
      hitTest(x, y);
    },
    [actions, hitTest, id, title, kind],
  );

  // Move / up / cancel run off `window` for the gesture's lifetime, not the
  // row, so the press is tracked and the release caught wherever the pointer
  // travels. A pen/touch point that drifts off the row — or a browser that
  // refused the pointer capture `engage` requests — would otherwise never
  // deliver the `pointerup`, leaving the lifted note frozen mid-air. Bound on
  // pointer-down (so even the pre-latch move/up is seen), dropped by `cleanup`.
  const handleMove = useCallback(
    (e: PointerEvent) => {
      if (pointerId.current !== e.pointerId) return;
      if (!active.current) {
        // Moved past the slop before the press latched → it's a scroll or a
        // swipe; stand down and leave the existing gesture untouched.
        if (
          Math.abs(e.clientX - startX.current) > MOVE_SLOP ||
          Math.abs(e.clientY - startY.current) > MOVE_SLOP
        ) {
          clearTimer();
        }
        return;
      }
      if (e.cancelable) e.preventDefault();
      hitTest(e.clientX, e.clientY);
    },
    [clearTimer, hitTest],
  );

  const handleUp = useCallback(
    (e: PointerEvent) => {
      if (pointerId.current !== e.pointerId) return;
      if (active.current) {
        justDragged.current = true;
        actions?.commit();
      }
      cleanup();
    },
    [actions, cleanup],
  );

  // A browser-initiated `pointercancel` (the UA seized the pointer for its own
  // gesture) aborts the drag — it must not commit a move the way a release does.
  const handleCancel = useCallback(
    (e: PointerEvent) => {
      if (pointerId.current !== e.pointerId) return;
      if (active.current) actions?.cancel();
      cleanup();
    },
    [actions, cleanup],
  );

  const bindWindow = useCallback(() => {
    detachWindow.current?.();
    // `passive: false` so `handleMove` may `preventDefault` to block scroll.
    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    detachWindow.current = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
    };
  }, [handleMove, handleUp, handleCancel]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse") return;
      pointerId.current = e.pointerId;
      targetEl.current = e.currentTarget;
      startX.current = e.clientX;
      startY.current = e.clientY;
      active.current = false;
      justDragged.current = false;
      const { clientX: x, clientY: y } = e;
      clearTimer();
      // Bind the rest of the gesture to `window` up front so even a pre-latch
      // move or a quick tap-release is tracked off the row.
      bindWindow();
      timer.current = window.setTimeout(() => engage(x, y), LONG_PRESS_MS);
    },
    [bindWindow, clearTimer, engage],
  );

  // Swallow the click that trails a drag so releasing over a folder files the
  // note instead of also opening it.
  const onClickCapture = useCallback((e: ReactMouseEvent) => {
    if (justDragged.current) {
      e.preventDefault();
      e.stopPropagation();
      justDragged.current = false;
    }
  }, []);

  // Drop any still-bound window listeners if the row unmounts mid-drag.
  useEffect(() => () => detachWindow.current?.(), []);

  if (!enabled) return { handlers: {}, dragging: false };

  return { handlers: { onPointerDown, onClickCapture }, dragging };
}
