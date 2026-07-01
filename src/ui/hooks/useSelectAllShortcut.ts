import { useEffect, useRef } from "react";

// Routes a bare Cmd/Ctrl+A pressed while nothing editable holds focus to the
// open editor's own select-all. An existing note opens with no focus at all
// (deliberate — it keeps the mobile soft keyboard down), so without this the
// browser answers the shortcut with its document-wide selection — title,
// header chrome and all — which can't be typed over or cut. Focus inside any
// editable element (the title field, a modal's input, the editor surface
// itself) keeps the browser's native field-scoped behaviour, and a press from
// inside an open dialog is left alone so select-all never steals focus from
// it.
export function useSelectAllShortcut(selectAll: () => void): void {
  const ref = useRef(selectAll);
  ref.current = selectAll;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "a") return;
      // The editor's own keydown handler (focus inside the surface) runs
      // first and prevents the default; don't select all twice.
      if (e.defaultPrevented) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        )
          return;
        if (target.closest('[role="dialog"], [role="alertdialog"]')) return;
      }
      e.preventDefault();
      ref.current();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
