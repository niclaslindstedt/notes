import { useT } from "../i18n/index.ts";
import { haptics } from "../platform/native-bridge.ts";
import { StarIcon } from "./icons.tsx";

// The leftmost button of the editor header's action cluster: a star that lifts
// the open note into the side menu's **Favorites** section (and drops it back
// out). It reads its state from its own artwork — a filled star for a
// favourite, an outline for the rest — rather than the filled-background
// treatment the find button uses for "the bar is up", because this is a
// property of the note, not a panel that's open.
export function FavoriteButton({
  favorite,
  onToggle,
}: {
  favorite: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const label = favorite ? t("app.unfavorite") : t("app.favorite");
  return (
    <button
      type="button"
      // Cancel the mousedown so the press doesn't blur the editing surface —
      // starring a note shouldn't cost you the caret you were typing at.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        haptics.vibrate(8);
        onToggle();
      }}
      title={label}
      aria-label={label}
      aria-pressed={favorite}
      className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] border border-accent/40 bg-transparent text-accent hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
    >
      <StarIcon className="h-[18px] w-[18px]" filled={favorite} />
    </button>
  );
}
