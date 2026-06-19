// Mirror the *visual* viewport's vertical band into CSS variables so every
// `position: fixed` overlay can pin to the region actually on screen rather
// than the layout viewport.
//
// `100svh` is a fixed value that ignores the on-screen keyboard, and in the
// iOS standalone PWA it doesn't always resolve to the true visible height —
// so a drawer or modal sized off it can come up short, leaving its
// bottom-pinned content (the side-menu footer, a dialog's actions) floating
// above the real edge. Reading `window.visualViewport.height` gives the exact
// visible height instead.
//
// The keyboard makes this matter twice over: focusing the editor's textarea
// shrinks and shifts the visual viewport, and iOS scrolls the visual viewport
// down by `offsetTop` (which `window.scrollTo` can't reset). Mirroring both
// `height` and `offsetTop` lets the overlays follow the keyboard instead of
// being pushed off the top of the screen.
//
// We deliberately do NOT mirror the horizontal axis. The keyboard never
// changes width/left, and `visualViewport.width` is fractional — a sub-pixel
// fixed layer becomes pannable sideways on iOS, and every horizontal pan then
// re-fires this handler, a feedback loop that surfaces as a stray horizontal
// scrollbar. The overlays stay pinned to the layout viewport horizontally
// (`left: 0; width: 100%`, see `appViewportRect.ts`).

import { useEffect } from "react";

export function useViewportHeight(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const root = document.documentElement;
    const sync = () => {
      root.style.setProperty("--app-height", `${vv.height}px`);
      root.style.setProperty("--app-top", `${vv.offsetTop}px`);
    };

    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--app-top");
    };
  }, []);
}
