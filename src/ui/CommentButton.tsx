import { useT } from "../i18n/index.ts";
import { haptics } from "../platform/native-bridge.ts";
import { CommentIcon } from "./icons.tsx";

/**
 * Header button that writes a [line comment](../../docs/overview.md#line-comments)
 * against the lines [select mode](../../docs/overview.md#select-mode) has
 * picked — the first of the writing tools, immediately left of the formatting
 * toggle.
 *
 * It sits there rather than among the four verbs the mode is for (cut, copy,
 * delete, format) because it is not a verb that acts on the note's text at all:
 * the other four rewrite the lines, this one leaves them exactly as they are
 * and says something *about* them. Left of formatting is where the row's
 * "writing" half begins, and a comment is the first thing you write.
 *
 * Like every other button in this row it refuses the mousedown: the run it is
 * about to comment on is held by the editing surface, and a press that blurred
 * it would drop the very lines the comment names.
 */
export function CommentButton({ onComment }: { onComment: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        haptics.vibrate(8);
        onComment();
      }}
      title={t("app.comments.add")}
      aria-label={t("app.comments.add")}
      className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] border border-accent/40 bg-transparent text-accent hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
    >
      <CommentIcon className="h-[18px] w-[18px]" />
    </button>
  );
}
