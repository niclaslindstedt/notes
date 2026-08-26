import { useLayoutEffect, useRef } from "react";

import { type CursorPaint } from "./multi-cursor-rects.ts";

// The carets and highlights of every cursor the browser isn't drawing.
//
// Drawn as a sibling of the editing host rather than inside it, for the same
// reason the empty-note prompt and the attachments block are: a
// `contenteditable={false}` island among the lines is a node the browser feels
// entitled to normalise around, and React then tears down nodes that are no
// longer where it left them. Out here the host still holds nothing but lines,
// and the overlay is pure paint — `pointer-events-none`, `aria-hidden`, and
// positioned in the scroller's coordinate space so it rides the note as it
// scrolls without being re-measured.
//
// The boxes themselves come from `measureCursors`; this component only paints
// them, which is what keeps it re-renderable on every keystroke.
export function MultiCursorOverlay({ paint }: { paint: CursorPaint }) {
  const caretLayer = useRef<HTMLDivElement>(null);

  // The blink runs on the **layer**, not on each caret. A CSS animation starts
  // when its element is inserted, so carets added as the column grows would
  // each blink on their own clock and the column would shimmer instead of
  // pulsing — one animation over all of them is in phase by construction.
  //
  // Restarting it after every paint is the other half: a caret that has just
  // moved (or just appeared) shows solid immediately and blinks from there,
  // which is what a text caret does everywhere else. The animation is reset
  // through its own object rather than by re-triggering the CSS — no reflow,
  // and nothing to undo. `getAnimations` is guarded for jsdom, which has none.
  useLayoutEffect(() => {
    for (const animation of caretLayer.current?.getAnimations?.() ?? [])
      animation.currentTime = 0;
  });

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {paint.selections.map((r, i) => (
        <div
          // Boxes are positional, and a paint replaces all of them at once —
          // there is no identity here beyond "the i-th box of this paint".
          key={`s${String(i)}`}
          className="multi-selection absolute rounded-[1px]"
          style={{
            left: r.left,
            top: r.top,
            width: r.width,
            height: r.height,
          }}
        />
      ))}
      <div ref={caretLayer} className="multi-caret-layer absolute inset-0 z-10">
        {paint.carets.map((r, i) => (
          <div
            key={`c${String(i)}`}
            className="multi-caret absolute w-[2px]"
            style={{ left: r.left - 1, top: r.top, height: r.height }}
          />
        ))}
      </div>
    </div>
  );
}
