import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { type Attachment } from "../../domain/attachment.ts";
import { useT } from "../../i18n/index.ts";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "../icons.tsx";

// Full-size viewer for a note's attached images: a dim, full-screen overlay
// showing the original at its natural size (capped to the viewport). Opened by
// clicking an inline thumbnail; dismissed with Escape, the close button, a
// backdrop click, or a swipe up/down. With more than one image it is a small
// gallery — arrow keys, the on-screen arrows, or a left/right swipe step
// through the set, and on a wide screen the neighbouring images peek in at the
// edges, smaller and dimmed, the way Finder's Quick Look gallery shows them.
// Deliberately not the shared `Modal` — an image wants the whole screen, edge
// to edge, not a bordered card.

type Props = {
  attachments: readonly Attachment[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
};

// Vertical travel that dismisses the viewer; horizontal travel that flips to
// the next/previous image. Movement before we commit to an axis.
const DISMISS_DISTANCE = 90;
const NAV_DISTANCE = 60;
const AXIS_LOCK = 10;

export function ImageViewer({
  attachments,
  index,
  onIndexChange,
  onClose,
}: Props) {
  const t = useT();
  const count = attachments.length;
  const current = attachments[index];
  const hasPrev = index > 0;
  const hasNext = index < count - 1;

  const goPrev = useCallback(() => {
    if (hasPrev) onIndexChange(index - 1);
  }, [hasPrev, index, onIndexChange]);
  const goNext = useCallback(() => {
    if (hasNext) onIndexChange(index + 1);
  }, [hasNext, index, onIndexChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext]);

  // Live drag: `drag` drives the active image's transform; the refs carry the
  // committed axis and last delta into the pointer-up decision without leaning
  // on a possibly-stale render closure.
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"none" | "h" | "v">("none");
  const last = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const dragged = useRef(false);
  const pointerId = useRef<number | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointerId.current = e.pointerId;
    start.current = { x: e.clientX, y: e.clientY };
    axis.current = "none";
    last.current = { dx: 0, dy: 0 };
    dragged.current = false;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== e.pointerId || !start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    if (axis.current === "none") {
      if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Pointer already released / not capturable — drag still works.
      }
    }
    dragged.current = true;
    const next = axis.current === "h" ? { dx, dy: 0 } : { dx: 0, dy };
    last.current = next;
    setDrag(next);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== e.pointerId) return;
    pointerId.current = null;
    const a = axis.current;
    const { dx, dy } = last.current;
    axis.current = "none";
    start.current = null;
    setDrag(null);
    if (a === "v" && Math.abs(dy) > DISMISS_DISTANCE) {
      onClose();
      return;
    }
    if (a === "h") {
      if (dx > NAV_DISTANCE) goPrev();
      else if (dx < -NAV_DISTANCE) goNext();
    }
  };

  // Swallow the click that trails a drag so a swipe-to-dismiss doesn't also
  // register as a backdrop click (which would itself close, harmlessly, but a
  // snap-back swipe must not close).
  const onClickCapture = (e: React.MouseEvent) => {
    if (dragged.current) {
      e.preventDefault();
      e.stopPropagation();
      dragged.current = false;
    }
  };

  if (!current) return null;

  const dragStyle = drag
    ? {
        transform: `translate(${drag.dx}px, ${drag.dy}px)`,
        opacity: 1 - Math.min(Math.abs(drag.dy) / 320, 0.6),
      }
    : undefined;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={current.filename}
      className="fixed inset-0 z-[90] touch-none overflow-hidden bg-black/80 backdrop-blur-sm select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={onClickCapture}
    >
      {/* A full-bleed button behind the images is the backdrop: clicking (or
          tab+Enter) anywhere off an image closes the viewer, with no click
          handler on a non-interactive element. */}
      <button
        type="button"
        onClick={onClose}
        aria-label={t("common.close")}
        className="absolute inset-0 cursor-zoom-out bg-transparent"
      />

      {/* The gallery layer is click-through (`pointer-events-none`) so empty
          space falls to the backdrop and the swipe handlers on the root. The
          neighbouring images are a decorative Finder-style peek (the arrow
          buttons, swipe, and arrow keys do the actual navigation). */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
        {hasPrev && (
          <img
            src={attachments[index - 1]!.data}
            alt=""
            aria-hidden
            draggable={false}
            className="absolute left-0 hidden max-h-[45vh] max-w-[20vw] -translate-x-[28%] rounded-[var(--radius)] object-contain opacity-40 shadow-2xl sm:block"
          />
        )}
        {hasNext && (
          <img
            src={attachments[index + 1]!.data}
            alt=""
            aria-hidden
            draggable={false}
            className="absolute right-0 hidden max-h-[45vh] max-w-[20vw] translate-x-[28%] rounded-[var(--radius)] object-contain opacity-40 shadow-2xl sm:block"
          />
        )}
        <img
          src={current.data}
          alt={current.filename}
          draggable={false}
          style={dragStyle}
          className={`pointer-events-auto relative z-[1] max-h-full max-w-full rounded-[var(--radius)] object-contain shadow-2xl ${
            drag ? "" : "transition-[transform,opacity] duration-200"
          }`}
        />
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label={t("common.close")}
        className="absolute top-3 right-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none pt-[max(0px,env(safe-area-inset-top))]"
      >
        <CloseIcon className="h-5 w-5" />
      </button>

      {hasPrev && (
        <button
          type="button"
          onClick={goPrev}
          aria-label={t("common.previous")}
          className="absolute top-1/2 left-3 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none sm:inline-flex"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          onClick={goNext}
          aria-label={t("common.next")}
          className="absolute top-1/2 right-3 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none sm:inline-flex"
        >
          <ChevronRightIcon className="h-5 w-5" />
        </button>
      )}

      {count > 1 && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-sm text-white tabular-nums pb-[max(0.25rem,env(safe-area-inset-bottom))]">
          {index + 1} / {count}
        </div>
      )}
    </div>
  );
}
