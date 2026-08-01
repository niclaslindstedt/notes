import { useT } from "../i18n/index.ts";
import { haptics } from "../platform/native-bridge.ts";
import { DeleteLineIcon } from "./icons.tsx";

// Header button that removes the line the caret sits on, immediately left of
// the copy button in the editor. Clearing a line by hand is a select-and-erase
// or a held Backspace; this is one tap, and the same edit is on Ctrl/Cmd+K for
// anyone with a keyboard. With the caret parked mid-line it trims only what
// follows it (see `deleteLine` in `src/domain/line-edit.ts`), so it doubles as
// "drop the rest of this sentence".
export function DeleteLineButton({ onDelete }: { onDelete: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      // Cancel the mousedown so the press doesn't blur the editing surface:
      // the caret has to stay where it is, or there is no line to delete.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        haptics.vibrate(8);
        onDelete();
      }}
      title={t("app.deleteLine")}
      aria-label={t("app.deleteLine")}
      className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] border border-accent/40 bg-transparent text-accent hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
    >
      <DeleteLineIcon className="h-[18px] w-[18px]" />
    </button>
  );
}
