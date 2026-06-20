import { createPortal } from "react-dom";

// Events that follow a tap. We swallow them at document capture phase
// during the brief window after the dismissing pointerdown so the
// browser never delivers them to the element under the tap — that's
// the only way to stop iOS from focusing a control it would otherwise
// focus as part of the synthesized mouse sequence.
const TRAILING_EVENTS = [
  "pointerup",
  "mousedown",
  "mouseup",
  "click",
  "touchend",
  "touchcancel",
  "contextmenu",
] as const;

// 300ms is comfortably above the ~50-100ms a trailing event sequence
// takes after pointerdown on every browser we target, and below the
// ~200ms a deliberate follow-up tap takes — so a stray tap is
// intercepted but a fresh tap lands cleanly.
const TRAILING_WINDOW_MS = 300;

// Install capture-phase listeners on `document` that swallow every
// trailing tap event for the window. Returns a teardown.
function installTrailingSwallow(): () => void {
  function swallow(ev: Event) {
    ev.preventDefault();
    ev.stopPropagation();
    (
      ev as Event & { stopImmediatePropagation?: () => void }
    ).stopImmediatePropagation?.();
  }
  for (const t of TRAILING_EVENTS) {
    document.addEventListener(t, swallow, true);
  }
  let torn = false;
  const tearDown = () => {
    if (torn) return;
    torn = true;
    for (const t of TRAILING_EVENTS) {
      document.removeEventListener(t, swallow, true);
    }
  };
  window.setTimeout(tearDown, TRAILING_WINDOW_MS);
  return tearDown;
}

// Invisible full-viewport backdrop that catches every tap outside the
// element it's escorting. Render it conditionally — when a popover /
// dropdown is open and should be treated as modal-from-the-rest-of-the-
// page. The host element (the dropdown panel) sits ABOVE the backdrop
// via its own higher z-index so taps on it still land where they should.
//
// Why a backdrop AND a document-level swallow:
//
// The backdrop alone catches the dismissing `pointerdown`, but the
// `onDismiss` callback (which closes the dropdown and unmounts THIS
// component) triggers a synchronous React render that tears the
// backdrop down before the rest of the tap sequence (`pointerup` /
// `mousedown` / `click`) arrives. Those trailing events then land on
// whatever element was underneath the tap — which on iOS is enough to
// focus the next control and pop the keyboard.
//
// `installTrailingSwallow` installs capture-phase listeners on
// `document` that survive the unmount: they run before React's root
// delegate sees the events, preventDefault the focus-shifting mouse
// events, and `stopImmediatePropagation` so React's onClick on the
// underlying button never fires. The listeners tear themselves down
// via a window-level `setTimeout` 300 ms later, so component unmount
// doesn't interrupt them.
export function DismissBackdrop({ onDismiss }: { onDismiss: () => void }) {
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    // React portals bubble events through the *React* tree, not the DOM
    // tree — even though this backdrop sits in `document.body`, its
    // parent in React is whatever rendered it. Stop propagation so the
    // dismissing pointerdown doesn't also reach handlers up the React
    // tree.
    e.stopPropagation();
    installTrailingSwallow();
    onDismiss();
  }

  return createPortal(
    <div
      aria-hidden
      className="fixed inset-0 z-[55]"
      onPointerDown={handlePointerDown}
    />,
    document.body,
  );
}
