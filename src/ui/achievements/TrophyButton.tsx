import { useAppearance } from "../../theme/useTheme.ts";
import { TrophyGlyph } from "../../achievements/glyphs.tsx";
import { useT } from "../../i18n/index.ts";
import { useModalDispatch } from "../modal-bus.ts";

// Header affordance for achievements, sitting beside the sync glyph. Two
// visual modes, each opening a different modal:
//
// - **Quiet (outline)** — nothing new to acknowledge. Click opens the full
//   four-tier achievements tour (`{ kind: "achievements" }`).
// - **Lit (accent)** — one or more achievements unlocked since they were last
//   acknowledged; a small count badge rides the corner. Click opens the
//   unlock notification modal listing just those new ones
//   (`{ kind: "achievements-unlock" }`); closing it clears the unseen queue,
//   returning the button to its quiet state.
//
// Reads the unseen count and the on/off flag from the synced appearance store.
// When achievements are switched off the trophy — the feature's only entry
// point — hides itself, removing the system wholesale.
export function TrophyButton() {
  const t = useT();
  const dispatch = useModalDispatch();
  const { unseenAchievements, disableAchievements } = useAppearance();
  if (disableAchievements) return null;
  const unseenCount = unseenAchievements.length;
  const lit = unseenCount > 0;
  const label = lit
    ? unseenCount === 1
      ? t("achievements.button.unseenOne")
      : t("achievements.button.unseenOther", { n: unseenCount })
    : t("achievements.button.open");
  return (
    <button
      type="button"
      onClick={() =>
        dispatch({ kind: lit ? "achievements-unlock" : "achievements" })
      }
      title={label}
      aria-label={label}
      className={`relative inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded border bg-transparent focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none ${
        lit
          ? "border-accent bg-accent/15 text-accent hover:bg-accent/25"
          : "border-line text-muted hover:bg-fg/5 hover:text-fg"
      }`}
    >
      <TrophyGlyph className="h-[18px] w-[18px]" />
      {lit && (
        <span className="absolute -top-1.5 -right-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-4 font-bold text-page-bg tabular-nums">
          {unseenCount}
        </span>
      )}
    </button>
  );
}
