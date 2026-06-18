import type { CSSProperties } from "react";

// Pins a `position: fixed` full-screen overlay over the same band as the
// app shell. The fallbacks reproduce a plain `inset: 0`; if a visual-
// viewport tracker is added later (to follow the iOS soft keyboard) it can
// set `--app-top` / `--app-height` and this layer will follow `#app`
// automatically. Horizontally it stays on the layout viewport (`left: 0;
// width: 100%`) so no layer can be pushed a sub-pixel past the edge and
// turn into a sideways pan on iOS. Mirrors checklist's `appViewportRect`.
export const APP_VIEWPORT_RECT: CSSProperties = {
  top: "var(--app-top, 0px)",
  left: 0,
  width: "100%",
  height: "var(--app-height, 100svh)",
};
