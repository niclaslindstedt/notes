import { useRef, type TouchEvent as ReactTouchEvent } from "react";

// Pull the note down from its top edge to put the soft keyboard away. On a
// phone the editor fills the screen, and with the iOS keyboard accessory bar
// hidden in the native wrapper there is no on-screen "hide keyboard" key — so a
// downward pull past the top is the gesture that lowers it: it blurs whatever
// editable element holds focus, which dismisses the keyboard.
//
// Armed only when the scroll container is already at its top (`scrollTop <= 0`),
// so scrolling up through a long note is left untouched, and it ignores
// mostly-horizontal drags. The editor's own pull-to-refresh stands down while a
// note is open, so this is the sole consumer of the top overscroll. Returns
// touch-handler props to spread onto the editor's scroll element; a mouse never
// produces these events, so it's inert on desktop.

// A downward travel this far (px), and clearly more vertical than horizontal,
// counts as a deliberate pull rather than a stray touch.
const PULL_THRESHOLD = 64;

type SwipeHandlers = {
  onTouchStart: (e: ReactTouchEvent) => void;
  onTouchMove: (e: ReactTouchEvent) => void;
  onTouchEnd: () => void;
};

export function useSwipeDownDismiss(onDismiss?: () => void): SwipeHandlers {
  const start = useRef<{ x: number; y: number; armed: boolean } | null>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  return {
    onTouchStart(e) {
      if (e.touches.length !== 1) {
        start.current = null;
        return;
      }
      const t = e.touches[0]!;
      // Arm only when there's nothing above to scroll to — a pull past the top
      // edge, not a scroll within the note.
      start.current = {
        x: t.clientX,
        y: t.clientY,
        armed: e.currentTarget.scrollTop <= 0,
      };
    },
    onTouchMove(e) {
      const s = start.current;
      if (!s || !s.armed || e.touches.length !== 1) return;
      const t = e.touches[0]!;
      const dy = t.clientY - s.y;
      const dx = t.clientX - s.x;
      if (dy > PULL_THRESHOLD && dy > Math.abs(dx) * 1.5) {
        // Fire once per gesture.
        s.armed = false;
        const active = document.activeElement;
        const editable =
          active instanceof HTMLElement &&
          (active.tagName === "TEXTAREA" ||
            active.tagName === "INPUT" ||
            active.isContentEditable);
        if (editable) {
          (active as HTMLElement).blur();
          onDismissRef.current?.();
        }
      }
    },
    onTouchEnd() {
      start.current = null;
    },
  };
}
