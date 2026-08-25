import { useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { useT } from "../i18n/index.ts";
import { haptics } from "../platform/native-bridge.ts";
import { CutIcon, TrashIcon } from "./icons.tsx";

// The floating action bar [select mode](../../docs/overview.md#select-mode)
// raises the moment a line is taken: one rounded pill hovering at the top of
// the note, split into a **cut** half and a **delete** half.
//
// It exists because on a phone the two things you most want to do with a run of
// lines are the two that were furthest away. The editor's header folds its
// whole action cluster behind a ⋯ on a narrow screen, so cutting what you just
// picked meant a press to unfold, a press to cut — and the unfold slides the
// buttons out over the note's title, nowhere near the lines. Deleting had no
// button at all: it was Backspace on a keyboard that select mode deliberately
// keeps down. So the actions come to the selection instead of the other way
// round, in a bar big enough to hit with a thumb without looking.
//
// **Touch only.** A mouse and keyboard already have both verbs — Ctrl/Cmd+X,
// Backspace, and an unfolded header with room for every button — so a bar
// hovering over the text there would be a permanent obstruction paying for
// nothing. The caller gates on `useDesktopPointer`, the same answer the
// header's own touch-only cut button uses.
//
// The pill is **portalled to `document.body`** rather than left in the editor:
// the note's scroller clips its own overflow and establishes a stacking
// context, so a bar nested inside it would be cut off at the top edge — the
// one place this one has to sit. Being out of the tree also means a press on
// it can't reach the surface's select-mode pointer handler underneath, which
// would otherwise take a line out from under the thumb aiming at Cut.
//
// It is centred on the **measured** box of the note's scroller rather than on
// `left: 50%` of the window. On a tablet the pinned sidebar offsets the note's
// column sideways from the layout viewport, and a hard-coded centre drifts into
// the sidebar; the same measurement is what puts the bar just under the header,
// whose height changes with the find bar and the safe-area inset.

/** How far below the top of the note's scroller the bar hovers. */
const PILL_GAP_PX = 12;

export function SelectActionPill({
  open,
  anchorRef,
  onCut,
  onDelete,
}: {
  /** Something is taken, so the bar has work to do. Drives the fade rather
   *  than the mount, so it slides away instead of vanishing. */
  open: boolean;
  /** The note's scroller — the box the bar centres on and hangs under. */
  anchorRef: RefObject<HTMLElement | null>;
  onCut: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setAt({ x: r.left + r.width / 2, y: r.top + PILL_GAP_PX });
    };
    measure();
    // The scroller's own box moves for reasons `resize` never fires on — the
    // find bar opening above it, the header folding its actions out — so watch
    // the element itself as well as the window. `visualViewport` is the third:
    // a soft keyboard shrinks the visual viewport without resizing the layout.
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    const vv = window.visualViewport;
    window.addEventListener("resize", measure);
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
    };
    // `open` is a dependency so the bar re-measures as it appears: the header
    // may have folded or the find bar closed while it was away.
  }, [anchorRef, open]);

  const press = (run: () => void) => () => {
    haptics.vibrate(8);
    run();
  };

  return createPortal(
    <div
      role="group"
      aria-label={t("app.selectMode.actions")}
      aria-hidden={!open}
      style={at ? { left: `${at.x}px`, top: `${at.y}px` } : undefined}
      // A hairline `gap-px` over the bar's own translucent backdrop is what
      // separates the two halves — they read as one pill with a seam rather
      // than as two buttons that happen to touch, which is what keeps a
      // destructive half from looking like a stray red button.
      className={`fixed z-[60] flex -translate-x-1/2 touch-none items-center gap-px overflow-hidden rounded-full bg-page-bg/40 shadow-lg transition-all duration-200 select-none ${
        at ? "" : "left-1/2"
      } ${open ? "scale-100 opacity-100" : "pointer-events-none scale-90 opacity-0"}`}
    >
      <button
        type="button"
        disabled={!open}
        // Cancel the press's default so it can't blur the editing surface: the
        // selection is what is about to be cut, and a blur that drops it would
        // leave the button with nothing to act on.
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        onClick={press(onCut)}
        aria-label={t("app.selectMode.cut")}
        title={t("app.selectMode.cut")}
        className="flex cursor-pointer items-center justify-center bg-link px-7 py-3 text-page-bg transition-[filter] active:brightness-90 disabled:opacity-40"
      >
        <CutIcon className="h-5 w-5" />
      </button>
      <button
        type="button"
        disabled={!open}
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        onClick={press(onDelete)}
        aria-label={t("app.selectMode.delete")}
        title={t("app.selectMode.delete")}
        // No confirm beat: the delete is one Undo away, and a confirm here
        // would cost a press on every deliberate use to guard against a rare
        // accidental one.
        className="flex cursor-pointer items-center justify-center bg-danger px-7 py-3 text-white transition-[filter] active:brightness-90 disabled:opacity-40"
      >
        <TrashIcon className="h-5 w-5" />
      </button>
    </div>,
    document.body,
  );
}
