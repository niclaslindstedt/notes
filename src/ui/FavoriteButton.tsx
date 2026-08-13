import { useT } from "../i18n/index.ts";
import { haptics } from "../platform/native-bridge.ts";
import { StarIcon } from "./icons.tsx";

// The leftmost button of the editor header's action cluster: a star that lifts
// the open note into the side menu's **Favorites** section (and drops it back
// out). A starred note fills the whole button with the accent and knocks the
// star out of it in the page colour — the same inverted treatment the [eye](
// ./LockButton.tsx) uses, so the two facts the header reports about the open
// note look alike from across the room instead of one being a lit chip and the
// other a slightly heavier 18px glyph. The artwork still swaps outline→filled
// with the state, which is what keeps the star legible once it is painted in
// the background colour.
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
      className={`inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] border transition-colors focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none ${
        favorite
          ? "border-accent bg-accent text-page-bg"
          : "border-accent/40 bg-transparent text-accent hover:bg-accent/10"
      }`}
    >
      <StarIcon className="h-[18px] w-[18px]" filled={favorite} />
    </button>
  );
}
