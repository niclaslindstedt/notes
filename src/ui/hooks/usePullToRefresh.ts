import { useCallback, useEffect, useRef, useState } from "react";

// Touch-driven pull-to-refresh for the note overview. Listens at the
// document level for a downward drag that starts while the scroll region is
// at the top, applies rubber-band damping, and fires `onRefresh` once the
// user crosses `TRIGGER_DISTANCE` and lets go.
//
// Deliberately touch-only — pull-to-refresh is a mobile gesture. Pointer
// events would also bake in "mouse drag refreshes the page" behaviour, which
// feels wrong with a trackpad's two-finger scroll.
//
// Scroll gate: the app pins its shell to the viewport (`html`/`body` are
// `overflow: hidden`) and scrolls the note list inside its own region, so
// `window.scrollY` is always 0. Instead we walk up from the touch target and
// require every scrollable ancestor to be at its top — a downward drag while
// the list is scrolled mid-way should scroll the list up, not arm a refresh.
//
// Modal gate: while any `[aria-modal="true"]` element is mounted (the
// settings dialog and friends set it), the gesture is suppressed so a
// downward drag inside a modal can't accidentally refresh the chrome behind
// it.

// Drag distance (px, after rubber-band damping) the user must reach before
// release fires `onRefresh`. Tuned to feel intentional but reachable in one
// thumb travel.
const TRIGGER_DISTANCE = 70;
// Max damped distance the indicator will travel. Past this point further
// pulling does nothing visually — it keeps the indicator from running off the
// band and signals "yes, it's armed; you can let go".
const MAX_PULL = 110;
// Resistance applied to raw finger travel so the gesture feels like pulling
// against a spring instead of one-to-one tracking. 0.5 = indicator moves half
// as far as the finger, matching the iOS-native pull-to-refresh feel closely
// enough.
const RESISTANCE = 0.5;

export type PullToRefreshState =
  // No drag in progress and not refreshing.
  | "idle"
  // User is dragging down but hasn't crossed the trigger distance yet —
  // releasing now would cancel.
  | "pulling"
  // User is dragging down and HAS crossed the trigger distance — releasing
  // now would fire `onRefresh`. Indicator flips its label / arrow direction.
  | "release"
  // `onRefresh` is in flight. Indicator shows a spinner; touch events are
  // ignored until the promise resolves.
  | "refreshing";

type Options = {
  // When false, the listener is mounted but no-ops. Used to gate by context —
  // e.g. don't allow a pull while the editor or a modal owns the screen.
  enabled?: boolean;
};

type Result = {
  state: PullToRefreshState;
  // Current damped pull distance in px (0..MAX_PULL). The indicator uses this
  // to translate / fade itself in as the user pulls.
  pullDistance: number;
};

function isFormInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest('input, textarea, select, [contenteditable="true"]') !== null
  );
}

function hasOpenModal(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

// True only if every scrollable ancestor of `target` is scrolled to its top.
// A non-scrolled list lets the pull arm; a mid-scrolled one hands the gesture
// back to normal scrolling.
function atScrollTop(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null;
  while (el && el !== document.body && el !== document.documentElement) {
    const overflowY = getComputedStyle(el).overflowY;
    const scrollable =
      (overflowY === "auto" || overflowY === "scroll") &&
      el.scrollHeight > el.clientHeight;
    if (scrollable && el.scrollTop > 0) return false;
    el = el.parentElement;
  }
  return true;
}

export function usePullToRefresh(
  onRefresh: () => Promise<void> | void,
  options: Options = {},
): Result {
  const { enabled = true } = options;
  const [state, setState] = useState<PullToRefreshState>("idle");
  const [pullDistance, setPullDistance] = useState(0);

  // Mirror state/refs so the document listeners don't churn on every distance
  // tick. The listeners read `stateRef` / `pullRef` / `onRefreshRef` and only
  // call `setState` / `setPullDistance` when the value actually changes.
  const stateRef = useRef<PullToRefreshState>("idle");
  const pullRef = useRef(0);
  const startYRef = useRef<number | null>(null);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const setStateBoth = useCallback((next: PullToRefreshState) => {
    if (stateRef.current === next) return;
    stateRef.current = next;
    setState(next);
  }, []);

  const setPullBoth = useCallback((next: number) => {
    if (pullRef.current === next) return;
    pullRef.current = next;
    setPullDistance(next);
  }, []);

  const resetIdle = useCallback(() => {
    startYRef.current = null;
    setPullBoth(0);
    setStateBoth("idle");
  }, [setPullBoth, setStateBoth]);

  useEffect(() => {
    if (!enabled) {
      // Disabling mid-gesture (a modal opening, the editor taking over) must
      // clear any armed pull — the document listeners are about to be torn
      // down, so no `touchend` will fire to reset the indicator and it would
      // otherwise stick on screen. Leave a refresh that's already in flight
      // alone; its own `finally` resets it.
      if (stateRef.current !== "refreshing") resetIdle();
      return;
    }

    const onTouchStart = (e: TouchEvent) => {
      if (stateRef.current === "refreshing") return;
      if (e.touches.length !== 1) return;
      if (hasOpenModal()) return;
      if (isFormInteractive(e.target)) return;
      if (!atScrollTop(e.target)) return;
      const touch = e.touches[0];
      if (!touch) return;
      startYRef.current = touch.clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startYRef.current === null) return;
      if (stateRef.current === "refreshing") return;
      const touch = e.touches[0];
      if (!touch) return;
      const delta = touch.clientY - startYRef.current;
      // Upward drag — release the gesture so normal scrolling resumes. Also
      // covers the "pulled down a bit, then up past start" hand wobble.
      if (delta <= 0) {
        resetIdle();
        return;
      }
      const damped = Math.min(delta * RESISTANCE, MAX_PULL);
      setPullBoth(damped);
      setStateBoth(damped >= TRIGGER_DISTANCE ? "release" : "pulling");
      // Suppress the browser's native overscroll handling (Chrome Android's
      // URL-bar pull-to-refresh) while we own the gesture. Only call once the
      // gesture is armed — leaving every touchmove passive when we're not
      // pulling keeps page scroll smooth.
      if (e.cancelable) e.preventDefault();
    };

    const onTouchEnd = () => {
      if (startYRef.current === null) return;
      const distance = pullRef.current;
      startYRef.current = null;
      if (distance >= TRIGGER_DISTANCE) {
        setStateBoth("refreshing");
        // Pin the indicator at the trigger position while the refresh is in
        // flight so it doesn't snap back before the user sees the spinner.
        setPullBoth(TRIGGER_DISTANCE);
        void Promise.resolve(onRefreshRef.current()).finally(() => {
          resetIdle();
        });
      } else {
        resetIdle();
      }
    };

    const onTouchCancel = () => {
      if (stateRef.current === "refreshing") return;
      resetIdle();
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    // `touchmove` must NOT be passive — we call `preventDefault()` once the
    // pull is armed to suppress the browser's native overscroll.
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("touchcancel", onTouchCancel);

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [enabled, resetIdle, setPullBoth, setStateBoth]);

  return { state, pullDistance };
}
