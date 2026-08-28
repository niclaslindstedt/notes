import { useT } from "../i18n/index.ts";
import { haptics } from "../platform/native-bridge.ts";
import { ChevronDownIcon, ChevronUpIcon } from "./icons.tsx";

// One of the two header buttons that shuffle the selected lines up or down the
// note — [moving lines](../../docs/overview.md#move-lines). They sit immediately
// right of the formatting button, in both of the header's action sets: the lines
// select mode has picked, and an ordinary selection that happens to cover whole
// lines.
//
// A chevron rather than an arrow: an arrow is the app's "go there" glyph (the
// back button, the export menu), and this doesn't travel anywhere — it nudges
// what is already picked one row over. Two buttons rather than one with a
// direction, because reordering is a *repeated* press and a control you have to
// re-aim between presses is the wrong shape for that.
//
// The same edit is on Alt+↑ / Alt+↓ for anyone with a keyboard (the shortcut
// every code editor binds), but the buttons are shown there too: reordering with
// the mouse alone should not require knowing a shortcut.
export function MoveLinesButton({
  direction,
  onMove,
}: {
  direction: -1 | 1;
  onMove: (direction: -1 | 1) => void;
}) {
  const t = useT();
  const label = t(direction === -1 ? "app.moveLines.up" : "app.moveLines.down");
  const Icon = direction === -1 ? ChevronUpIcon : ChevronDownIcon;
  return (
    <button
      type="button"
      // Cancel the mousedown so the press doesn't blur the editing surface: the
      // selection is what is about to move, and a blur that dropped it would
      // leave the button with nothing to act on — and the next press with
      // nothing to repeat.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        haptics.vibrate(8);
        onMove(direction);
      }}
      title={label}
      aria-label={label}
      className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] border border-accent/40 bg-transparent text-accent hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}
