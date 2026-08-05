import { useT } from "../i18n/index.ts";
import { haptics } from "../platform/native-bridge.ts";
import { CutIcon } from "./icons.tsx";

// Header button that cuts at the caret — what it removes goes on the clipboard
// on its way out — immediately left of the copy button in the editor. Clearing a
// line by hand is a select-and-erase or a held Backspace; this is one tap, and
// the same edit is on Ctrl/Cmd+K for anyone with a keyboard. What it takes
// depends on where the caret is (see `cutLine` in `src/domain/line-edit.ts`):
// the selection when there is one, the rest of the line from a mid-line caret,
// and otherwise the whole line.
export function CutButton({ onCut }: { onCut: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      // Cancel the mousedown so the press doesn't blur the editing surface:
      // the caret (and any selection) has to stay where it is, or there is
      // nothing left to cut.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        haptics.vibrate(8);
        onCut();
      }}
      title={t("app.cut")}
      aria-label={t("app.cut")}
      className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] border border-accent/40 bg-transparent text-accent hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
    >
      <CutIcon className="h-[18px] w-[18px]" />
    </button>
  );
}
