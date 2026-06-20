import { useEffect } from "react";

// Calls `onEscape` when the user presses Escape, but only while
// `enabled` is true. Used by the custom dropdown (`FloatingPanel`); the
// `enabled` gate lets the call site mirror its own `open` state without
// the listener firing on stray key presses while closed.
//
// The listener runs in the CAPTURE phase and calls
// `stopImmediatePropagation` so a dropdown opened inside the settings
// `Modal` swallows the Escape that closes it before the modal's own
// (bubble-phase) Escape handler can see it — pressing Escape collapses
// the open dropdown first, leaving the dialog up, the way a native
// `<select>` behaves. A second Escape then reaches the modal.
export function useEscapeKey(enabled: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onEscape();
    }
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [enabled, onEscape]);
}
