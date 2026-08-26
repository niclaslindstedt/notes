import { useT } from "../i18n/index.ts";
import { haptics } from "../platform/native-bridge.ts";
import { TrashIcon } from "./icons.tsx";

// Header button that takes the lines [select mode](../../docs/overview.md#select-mode)
// has picked straight out of the note — the fourth of the
// [selection actions](NoteEditor.tsx), immediately right of copy.
//
// It is the one verb select mode had no button for. Cut, copy and formatting
// were already in the header the moment something was selected; delete lived
// only on Backspace, on a keyboard the mode deliberately keeps down. So it
// joins them there rather than hovering over the note in a bar of its own: one
// row, four verbs, all of them where every other action on the note already is.
//
// It carries the danger tone rather than the accent every other header button
// wears — it is the only one that destroys something, and it sits next to a
// copy button it must not be mistaken for at thumb speed.
//
// No confirm beat: the delete is one Undo away, and a confirm would cost a
// press on every deliberate use to guard against a rare accidental one.
export function DeleteLinesButton({ onDelete }: { onDelete: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      // Cancel the mousedown so the press doesn't blur the editing surface:
      // the run is what is about to be deleted, and a blur that drops it would
      // leave the button with nothing to act on.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        haptics.vibrate(8);
        onDelete();
      }}
      title={t("app.selectMode.delete")}
      aria-label={t("app.selectMode.delete")}
      className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] border border-danger/40 bg-transparent text-danger hover:bg-danger/10 focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
    >
      <TrashIcon className="h-[18px] w-[18px]" />
    </button>
  );
}
