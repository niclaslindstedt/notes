// Pure geometry for the draggable floating navigation button. Translates
// between the persisted `MenuButtonPosition` (an edge + a 0..1 vertical
// fraction) and concrete top-left pixel coordinates against a viewport,
// and back again when a drag ends. Kept free of React and the DOM so the
// snap / clamp maths can be unit-tested in isolation; `SideMenu` and its
// drag hook own the event wiring.
//
// All coordinates are in the visual viewport's client space: `vw`/`vh`
// are its visible size and `offsetLeft`/`offsetTop` its top-left within
// the layout viewport. On iOS the software keyboard shrinks the visual
// viewport (and can offset it) without touching `window.innerHeight`, so
// the button — `position: fixed`, hence laid out against that same client
// space — must be clamped to the visible box or it disappears behind the
// keyboard. Passing the offsets keeps the resting spot normalized into
// whatever space is left, and the drag clamp reachable.

// Which vertical edge the floating navigation button rests against once
// the user lets go of a drag.
export type MenuButtonSide = "left" | "right";

// The user's chosen resting spot for the floating navigation button.
// `side` picks the edge it snaps to; `y` is its vertical position as a
// fraction (0 = top, 1 = bottom) of the available travel, so it survives
// viewport resizes without storing raw pixels.
export type MenuButtonPosition = { side: MenuButtonSide; y: number };

// The button's footprint (h-11 w-11 → 44px) and the gap it keeps from the
// viewport edges (left-3 → 0.75rem → 12px). Mirrored by the Tailwind
// classes in `SideMenu`; kept here so the maths and the styling agree.
export const MENU_BUTTON_SIZE = 44;
export const MENU_BUTTON_MARGIN = 12;

/** Clamp `n` into the inclusive unit interval [0, 1]. */
export function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** The vertical pixels the button's top edge can travel between margins. */
function verticalTravel(vh: number, size: number, margin: number): number {
  return Math.max(0, vh - 2 * margin - size);
}

/** The button's resting top-left pixel coordinates for a saved position. */
export function restingRect(
  pos: MenuButtonPosition,
  vw: number,
  vh: number,
  size = MENU_BUTTON_SIZE,
  margin = MENU_BUTTON_MARGIN,
  offsetLeft = 0,
  offsetTop = 0,
): { left: number; top: number } {
  const left = offsetLeft + (pos.side === "left" ? margin : vw - margin - size);
  const top =
    offsetTop + margin + clampUnit(pos.y) * verticalTravel(vh, size, margin);
  return { left, top };
}

/** Keep a free-dragged top-left inside the margin-inset viewport box. */
export function clampRect(
  left: number,
  top: number,
  vw: number,
  vh: number,
  size = MENU_BUTTON_SIZE,
  margin = MENU_BUTTON_MARGIN,
  offsetLeft = 0,
  offsetTop = 0,
): { left: number; top: number } {
  const minLeft = offsetLeft + margin;
  const minTop = offsetTop + margin;
  const maxLeft = Math.max(minLeft, offsetLeft + vw - margin - size);
  const maxTop = Math.max(minTop, offsetTop + vh - margin - size);
  return {
    left: Math.min(maxLeft, Math.max(minLeft, left)),
    top: Math.min(maxTop, Math.max(minTop, top)),
  };
}

/**
 * Snap a dropped top-left back into a saveable `MenuButtonPosition`: the
 * nearer horizontal edge (by the button's centre) plus the vertical
 * fraction it came to rest at.
 */
export function rectToPosition(
  left: number,
  top: number,
  vw: number,
  vh: number,
  size = MENU_BUTTON_SIZE,
  margin = MENU_BUTTON_MARGIN,
  offsetLeft = 0,
  offsetTop = 0,
): MenuButtonPosition {
  const localLeft = left - offsetLeft;
  const side = localLeft + size / 2 < vw / 2 ? "left" : "right";
  const travel = verticalTravel(vh, size, margin);
  const y = travel > 0 ? clampUnit((top - offsetTop - margin) / travel) : 0.5;
  return { side, y };
}
