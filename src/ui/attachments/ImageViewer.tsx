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
// through the set. The images sit side by side on a single track that slides
// horizontally, so a swipe drags the neighbouring image into place and the
// commit animates the rest of the way — a real swipe, not a snap-back-and-swap.
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

  // Live drag: `drag` drives the track's transform; the refs carry the
  // committed axis and last delta into the pointer-up decision without leaning
  // on a possibly-stale render closure.
  const [drag, setDrag] = useState<{ axis: "h" | "v"; delta: number } | null>(
    null,
  );
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"none" | "h" | "v">("none");
  const last = useRef<{ axis: "none" | "h" | "v"; delta: number }>({
    axis: "none",
    delta: 0,
  });
  const dragged = useRef(false);
  const pointerId = useRef<number | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointerId.current = e.pointerId;
    start.current = { x: e.clientX, y: e.clientY };
    axis.current = "none";
    last.current = { axis: "none", delta: 0 };
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
    const a = axis.current;
    const delta = a === "h" ? dx : dy;
    last.current = { axis: a, delta };
    setDrag({ axis: a, delta });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== e.pointerId) return;
    pointerId.current = null;
    const { axis: a, delta } = last.current;
    axis.current = "none";
    start.current = null;
    setDrag(null);
    if (a === "v" && Math.abs(delta) > DISMISS_DISTANCE) {
      onClose();
      return;
    }
    if (a === "h") {
      // A horizontal release commits to the neighbour; resetting `drag` to null
      // lets the track's transition animate the remaining distance into place
      // (or snap back at the ends, where goPrev/goNext is a no-op).
      if (delta > NAV_DISTANCE) goPrev();
      else if (delta < -NAV_DISTANCE) goNext();
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

  const horiz = drag?.axis === "h" ? drag.delta : 0;
  const vert = drag?.axis === "v" ? drag.delta : 0;
  // The track holds every image side by side; sliding it -index×100% parks the
  // current one on screen, and the live drag adds the finger's pixel offset.
  const trackStyle: React.CSSProperties = {
    transform: `translate3d(calc(${-index * 100}% + ${horiz}px), ${vert}px, 0)`,
    opacity: vert ? 1 - Math.min(Math.abs(vert) / 320, 0.6) : 1,
  };

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

      {/* The sliding gallery track. It's click-through (`pointer-events-none`)
          so empty space falls to the backdrop and the swipe handlers on the
          root; only the images themselves take pointer events. */}
      <div
        style={trackStyle}
        className={`pointer-events-none absolute inset-0 flex h-full w-full ${
          drag ? "" : "transition-[transform,opacity] duration-200"
        }`}
      >
        {attachments.map((a, i) => (
          <div
            key={a.filename}
            className="flex h-full w-full flex-shrink-0 items-center justify-center p-4"
          >
            <img
              src={a.data}
              alt={i === index ? a.filename : ""}
              aria-hidden={i === index ? undefined : true}
              draggable={false}
              className="pointer-events-auto max-h-full max-w-full rounded-[var(--radius)] object-contain shadow-2xl"
            />
          </div>
        ))}
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
        <div className="pointer-events-none absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-10 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-sm text-white tabular-nums">
          {index + 1} / {count}
        </div>
      )}
    </div>
  );
}
