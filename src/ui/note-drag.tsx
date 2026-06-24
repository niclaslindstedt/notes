// Touch drag-and-drop for filing notes into folders. Native HTML5 drag
// (`draggable` + `dragstart`/`drop`) only works with a mouse, so on a
// touchscreen this provides the equivalent gesture: **press and hold** a note
// to pick it up, drag it over a folder, and release to file it. The desktop
// HTML5 path is left as-is in the side menu / overview; this layer is the
// touch-only complement, gated by the caller to coarse pointers.
//
// ## How it coexists with swipe-to-archive/delete
//
// A note row already swipes (left = delete, right = archive) via
// `useSwipeReveal`, which commits to a horizontal gesture only after 8px of
// movement. The long-press here fires from *holding still*: if the finger
// moves past a small slop before the timer elapses it's a swipe or a scroll
// and we bail, leaving the existing gestures untouched. Once the press
// latches we capture the pointer (so the inner swipe element stops seeing
// moves) and block page scroll for the rest of the drag.
//
// ## Drop targets
//
// A drop target marks itself with the `data-note-drop` attribute carrying its
// folder id (or `NOTE_DROP_ROOT` for the ungrouped zone). The dragged item
// owns the pointer, so it hit-tests with `elementFromPoint` on every move and
// reports the target under the finger; the provider resolves that key into the
// `folderId` handed to `onMove` (null = ungrouped). Targets read the active
// key via `useNoteDropKey` to paint a highlight.
//
// The non-component half — the contexts, the `useTouchNoteDrag` hook, and the
// drop-target constants — lives in `note-drag-context.ts`.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";

import { useReportDragActivity } from "./drag-activity.ts";
import { FolderIcon, NoteIcon } from "./icons.tsx";
import {
  ActionsContext,
  DragAbortContext,
  DragKindContext,
  DropKeyContext,
  useTouchNoteDrag,
  type DragActions,
  type DragItem,
  type DragKind,
} from "./note-drag-context.ts";

export function NoteDragProvider({
  onDrop,
  aborted = false,
  children,
}: {
  // Fired when an item (a note or a folder) is released over a drop target.
  // `key` is the target's `data-note-drop` value (folder id / `NOTE_DROP_ROOT`
  // / `NOTE_DROP_ARCHIVE` / `ns:<slug>`); the caller resolves the `(item, key)`
  // pair to the right action (a folder only acts on a namespace target).
  onDrop: (item: DragItem, key: string) => void;
  // When true, any in-flight drag is torn down: a sync-conflict modal (or a
  // background reload) has seized the screen, so the lifted note must not stay
  // frozen on top of it waiting for a pointerup/`dragend` that won't come.
  aborted?: boolean;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState<{
    kind: DragKind;
    title: string;
  } | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  // Bumped to tell every active row (and the native drop zones) to tear their
  // drag down when `aborted` rises — see `DragAbortContext`.
  const [abortGen, setAbortGen] = useState(0);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  // Latest fingertip position, kept on a ref so the callback ref can place the
  // chip the instant it mounts (see `setGhostRef`).
  const ghostPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Live mirrors so the memoised actions read current values without being
  // rebuilt (which would re-fire the touch handlers' closures).
  const itemRef = useRef<DragItem | null>(null);
  const dropKeyRef = useRef<string | null>(null);

  // Sit the chip just above the fingertip, horizontally centred on it.
  const applyGhostTransform = useCallback((el: HTMLDivElement) => {
    const { x, y } = ghostPos.current;
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -150%)`;
  }, []);

  const positionGhost = useCallback(
    (x: number, y: number) => {
      ghostPos.current = { x, y };
      const el = ghostRef.current;
      if (el) applyGhostTransform(el);
    },
    [applyGhostTransform],
  );

  // Callback ref: place the chip in the same commit it mounts, before the
  // browser paints. `begin` records the pickup point first, so the chip is
  // never shown at its `top-0 left-0` default while waiting for the first move.
  const setGhostRef = useCallback(
    (el: HTMLDivElement | null) => {
      ghostRef.current = el;
      if (el) applyGhostTransform(el);
    },
    [applyGhostTransform],
  );

  // Drop the floating chip and forget the in-flight drag without committing a
  // move. Shared by the `cancel` action (a pointercancel) and the abort effect.
  const cancelDrag = useCallback(() => {
    itemRef.current = null;
    dropKeyRef.current = null;
    setDragging(null);
    setDropKey(null);
  }, []);

  // Report the live touch/pointer drag up so the document-level pull-to-refresh
  // stands down — dragging a note downward to a lower folder / the archive
  // would otherwise arm a refresh at the same time.
  const reportDrag = useReportDragActivity();
  const isDragging = dragging !== null;
  useEffect(() => {
    reportDrag(isDragging);
    return () => {
      if (isDragging) reportDrag(false);
    };
  }, [isDragging, reportDrag]);

  // When the app raises `aborted` (a sync-conflict modal surfaced over the
  // list), tear any in-flight drag down: clear the chip and bump the abort
  // generation so the active row releases its pointer capture and the native
  // drop zones drop their lift styling.
  useEffect(() => {
    if (!aborted) return;
    cancelDrag();
    setAbortGen((g) => g + 1);
  }, [aborted, cancelDrag]);

  const actions = useMemo<DragActions>(
    () => ({
      begin(item, x, y) {
        itemRef.current = item;
        dropKeyRef.current = null;
        // Record the pickup point so the chip's callback ref can place it the
        // moment it mounts, rather than flashing at the top-left default.
        positionGhost(x, y);
        setDragging({ kind: item.kind, title: item.title });
        setDropKey(null);
      },
      hover(key, x, y) {
        positionGhost(x, y);
        if (dropKeyRef.current !== key) {
          dropKeyRef.current = key;
          setDropKey(key);
        }
      },
      commit() {
        const item = itemRef.current;
        const key = dropKeyRef.current;
        if (item && key !== null) onDrop(item, key);
        itemRef.current = null;
        dropKeyRef.current = null;
        setDragging(null);
        setDropKey(null);
      },
      cancel: cancelDrag,
    }),
    [onDrop, positionGhost, cancelDrag],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <DragAbortContext.Provider value={abortGen}>
        <DragKindContext.Provider value={dragging?.kind ?? null}>
          <DropKeyContext.Provider value={dropKey}>
            {children}
            {dragging && (
              <div
                ref={setGhostRef}
                aria-hidden
                className="pointer-events-none fixed top-0 left-0 z-[100] flex max-w-[70vw] items-center gap-2 rounded-[var(--radius)] border border-accent/40 bg-surface-2 px-3 py-1.5 text-sm text-fg-bright shadow-lg"
              >
                {dragging.kind === "folder" ? (
                  <FolderIcon className="h-4 w-4 shrink-0 text-accent" />
                ) : (
                  <NoteIcon className="h-4 w-4 shrink-0 text-accent" />
                )}
                <span className="truncate">{dragging.title || "Untitled"}</span>
              </div>
            )}
          </DropKeyContext.Provider>
        </DragKindContext.Provider>
      </DragAbortContext.Provider>
    </ActionsContext.Provider>
  );
}

// The wrapper a draggable note (or folder) row renders through: it carries the
// desktop HTML5 drag props (when `draggable`) and the touch long-press handlers
// (when `enabled`), and dims itself while it's the one being dragged.
export function NoteDragItem({
  noteId,
  title,
  kind = "note",
  enabled,
  draggable,
  dragging: desktopDragging,
  onDragStart,
  onDragEnd,
  className,
  children,
}: {
  noteId: string;
  title: string;
  /** What this row represents — a single note (default) or a whole folder. */
  kind?: DragKind;
  /** Touch long-press drag is wired (coarse pointer). */
  enabled: boolean;
  /** Desktop HTML5 drag is wired (fine pointer). */
  draggable?: boolean;
  /** The desktop drag state for this row, for the lift styling. */
  dragging?: boolean;
  onDragStart?: (e: ReactDragEvent) => void;
  onDragEnd?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const { handlers, dragging: touchDragging } = useTouchNoteDrag(
    noteId,
    title,
    kind,
    enabled,
  );
  const isDragging = enabled ? touchDragging : Boolean(desktopDragging);
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      {...handlers}
      className={`${className ?? ""} ${isDragging ? "opacity-40" : ""}`.trim()}
    >
      {children}
    </div>
  );
}
