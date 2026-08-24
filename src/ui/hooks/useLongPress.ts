// Press-and-hold on a button, as a second action alongside the ordinary press.
//
// The app uses this for exactly one thing today: holding a "new note" button
// makes a [dropzone note](../../../docs/overview.md#dropzone) instead of an
// ordinary one. The gesture is deliberately the same on a phone and on a
// computer — pointer events cover a finger and a mouse alike — so the feature
// is discoverable from either, and it costs the button nothing when the caller
// passes no `onLongPress` (the handlers then reduce to a plain `onClick`).
//
// Two details make it behave rather than fight the platform:
//
// - **Holding still is the gesture.** More than `SLOP` pixels of movement
//   before the timer elapses means the user is scrolling or dragging, not
//   holding, so the press is abandoned — the same rule the note-drag
//   long-press uses (see `note-drag.tsx`), which is what lets both live on the
//   same screen.
// - **The trailing click is swallowed.** A touchscreen still delivers a
//   `click` after the finger comes up, and a browser that popped its own
//   callout still delivers one too; without the latch below, holding the
//   button would fire the long press *and* the ordinary press.

import { useCallback, useEffect, useRef } from "react";

import { haptics } from "../../platform/native-bridge.ts";

/** How long the button must be held before the long press fires. */
const HOLD_MS = 500;
/** Movement that abandons the hold (a scroll or a drag, not a press). */
const SLOP = 8;
/** The tick of feedback that says "the hold took" — inert where unsupported. */
const HOLD_FEEDBACK_MS = 12;

export type LongPressHandlers = {
  onPointerDown: (e: { clientX: number; clientY: number }) => void;
  onPointerMove: (e: { clientX: number; clientY: number }) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  onClick: () => void;
  onContextMenu: (e: { preventDefault: () => void }) => void;
};

export function useLongPress({
  onPress,
  onLongPress,
  delay = HOLD_MS,
}: {
  /** The ordinary press. Fired on click unless the hold got there first. */
  onPress: () => void;
  /** The hold. Omitted, the button behaves exactly as it did without this hook. */
  onLongPress?: () => void;
  delay?: number;
}): LongPressHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  // Latched by a fired hold, consumed by the click that trails it.
  const fired = useRef(false);
  // Read through refs so the handlers below keep a stable identity across the
  // renders a press spans.
  const pressRef = useRef(onPress);
  pressRef.current = onPress;
  const longPressRef = useRef(onLongPress);
  longPressRef.current = onLongPress;

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return {
    onPointerDown: (e) => {
      cancel();
      fired.current = false;
      if (!longPressRef.current) return;
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        origin.current = null;
        fired.current = true;
        // Confirm the hold took *before* anything appears, so the user can let
        // go the moment they feel it rather than holding on to be sure.
        haptics.vibrate(HOLD_FEEDBACK_MS);
        longPressRef.current?.();
      }, delay);
    },
    onPointerMove: (e) => {
      const start = origin.current;
      if (!start) return;
      if (
        Math.abs(e.clientX - start.x) > SLOP ||
        Math.abs(e.clientY - start.y) > SLOP
      ) {
        cancel();
      }
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClick: () => {
      // The click that trails a fired hold isn't a second request — drop it.
      if (fired.current) {
        fired.current = false;
        return;
      }
      pressRef.current();
    },
    // A long press on a touchscreen otherwise raises the browser's own
    // callout (and on a desktop right-click, its context menu) over the button
    // we've just given a second meaning to.
    onContextMenu: (e) => {
      if (longPressRef.current) e.preventDefault();
    },
  };
}
