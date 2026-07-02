import { useEffect } from "react";

// Global Cmd/Ctrl+Z (undo) and Cmd/Ctrl+Shift+Z / Ctrl+Y (redo), ported from
// checklist. Bails out when focus is inside a plain `<input>` / `<textarea>` /
// `<select>` (the note title, settings fields, modal inputs) so the browser's
// native field-level undo keeps working there.
//
// It must NOT bail for the live-preview editor's `contenteditable`, though:
// that surface deliberately swallows the browser's native `historyUndo` /
// `historyRedo` (see `MarkdownEditor` — React owns its DOM, so native undo
// would corrupt it), so if this handler also stood down inside it there would
// be *no* undo at all while the caret sits in a note — pressing ⌘/Ctrl+Z after
// a typo would do nothing. So the document-level timeline answers the shortcut
// there, reverting the current editing session (matching the side menu's
// Undo / Redo buttons). The app has exactly one editable contenteditable — the
// editor — so treating any contenteditable as app-owned is safe here.
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
        // Plain fields keep their native, character-level undo. The
        // live-preview editor's contenteditable is intentionally excluded (see
        // the note above) so this handler answers ⌘/Ctrl+Z there instead.
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
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
