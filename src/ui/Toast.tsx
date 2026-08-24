import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { usePwaUpdate } from "../pwa/usePwaUpdate.ts";
import { dockedSidebarWidth, useNav } from "./nav-context.ts";

// A transient confirmation pill — "Copied", and whatever else needs to say
// "that worked" without stealing focus or asking for a press. The caller owns
// the timer and simply stops rendering the toast when it expires; this
// component owns only where it sits and how it announces itself.
//
// **It docks the way `UpdateToast` does** — pinned above the safe-area inset,
// inset past the side menu when the menu is pinned open as a sidebar so it
// centres within the notes content band rather than the whole viewport — and
// **stacks above it**, which is the layering that toast was written to expect.
// A persistent "an update is ready" prompt and a 1.6-second tick would
// otherwise land on the same pixels.
//
// **It portals to `document.body`** (the same reason `FloatingPanel` does).
// Callers live inside the note header, which paints itself with
// `backdrop-blur` — and a `backdrop-filter` makes an element the containing
// block for its `fixed` descendants, so a toast left in place would dock to
// the bottom of the *header* rather than the bottom of the screen.
//
// `role="status"` + `aria-live="polite"` is deliberate over `alert`: the
// message confirms something the user just did, so it should be read after the
// current utterance rather than interrupting it.
//
// An optional `action` grows the pill a trailing button — "Undo", and whatever
// else offers a one-press way back from the thing just confirmed. The pill
// stays `pointer-events-none` so the message never swallows a tap meant for
// what's underneath; only the button itself catches presses.
export function Toast({
  message,
  icon,
  action,
}: {
  message: string;
  /** Optional leading glyph, sized by the caller (`h-4 w-4` reads best). */
  icon?: ReactNode;
  /** Optional trailing button — a one-press way back from the confirmed act. */
  action?: { label: string; onAction: () => void };
}) {
  const nav = useNav();
  const { position } = nav;
  const { needRefresh } = usePwaUpdate();

  // Match whatever the side menu occupies on its edge so `mx-auto` centres the
  // pill in the remaining content band; fall back to the 0.75rem edge gutter
  // when there is no docked sidebar at all — a folded-away one included, since
  // its collapse rail only overlays the notes rather than displacing them.
  const sidebar = dockedSidebarWidth(nav);
  const gutter = "max(0.75rem,env(safe-area-inset-bottom))";

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      style={{
        left: position.side === "left" ? sidebar : undefined,
        right: position.side === "right" ? sidebar : undefined,
        // Clear the update prompt's own height plus a gap when one is showing.
        bottom: needRefresh ? `calc(${gutter} + 4.5rem)` : gutter,
      }}
      className="toast-in pointer-events-none fixed inset-x-3 z-[70] mx-auto flex w-fit max-w-md items-center gap-2 rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm font-medium text-fg shadow-md"
    >
      {icon}
      <span className="min-w-0 truncate">{message}</span>
      {action && (
        <button
          type="button"
          onClick={action.onAction}
          className="pointer-events-auto shrink-0 cursor-pointer rounded-[var(--radius)] px-2 py-0.5 font-semibold text-accent hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
        >
          {action.label}
        </button>
      )}
    </div>,
    document.body,
  );
}
