import { useEffect } from "react";

// Global Cmd/Ctrl+Z (undo) and Cmd/Ctrl+Shift+Z / Ctrl+Y (redo), ported from
// checklist. Bails out when focus is inside an editable element so the
// browser's native field-level undo keeps working while the user is typing in
// a note's editor — the global timeline only steps the document-level history
// (create / delete a note, a whole editing session) once focus leaves the
// text.
export function useUndoRedoShortcuts(params: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}): void {
  const { canUndo, canRedo, onUndo, onRedo } = params;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      const isUndo = key === "z" && !e.shiftKey;
      const isRedo = (key === "z" && e.shiftKey) || key === "y";
      if (!isUndo && !isRedo) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (isUndo && canUndo) {
        e.preventDefault();
        onUndo();
      } else if (isRedo && canRedo) {
        e.preventDefault();
        onRedo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canUndo, canRedo, onUndo, onRedo]);
}
