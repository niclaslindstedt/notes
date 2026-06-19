import { useAppearance } from "../../theme/useTheme.ts";
import { TrophyGlyph } from "../../achievements/glyphs.tsx";
import { useT } from "../../i18n/index.ts";
import { useModalDispatch } from "../modal-bus.ts";

// The achievements entry, living as a row in the side menu's footer (it used
// to be a header button). Two visual modes, each opening a different modal:
//
// - **Quiet** — nothing new to acknowledge. Click opens the full four-tier
//   achievements tour (`{ kind: "achievements" }`).
// - **Lit** — one or more achievements unlocked since they were last
//   acknowledged; a small accent count badge rides the trailing edge. Click
//   opens the unlock notification modal listing just those new ones
//   (`{ kind: "achievements-unlock" }`); closing it clears the unseen queue.
//
// The trophy glyph is tinted to the accent once *any* achievement is earned
// and stays muted (greyed out) until then, so a glance at the menu tells you
// whether you've started collecting. Reads the earned map, the unseen count,
// and the on/off flag from the synced appearance store; when achievements are
// switched off the row — the feature's only entry point — hides itself,
// removing the system wholesale.
export function AchievementsMenuItem({ onClose }: { onClose: () => void }) {
  const t = useT();
  const dispatch = useModalDispatch();
  const { achievements, unseenAchievements, disableAchievements } =
    useAppearance();
  if (disableAchievements) return null;
  const unseenCount = unseenAchievements.length;
  const lit = unseenCount > 0;
  const earned = Object.keys(achievements).length > 0;
  const label = lit
    ? unseenCount === 1
      ? t("achievements.button.unseenOne")
      : t("achievements.button.unseenOther", { n: unseenCount })
    : t("achievements.button.open");
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        onClose();
        dispatch({ kind: lit ? "achievements-unlock" : "achievements" });
      }}
      title={label}
      className="flex w-full cursor-pointer items-center gap-3 px-5 py-[var(--density-row-py)] text-left text-sm text-fg hover:bg-surface-2 hover:text-fg-bright"
    >
      <span className={earned ? "text-accent" : "text-muted"}>
        <TrophyGlyph className="h-5 w-5" />
      </span>
      <span className="flex-1">{t("achievements.button.open")}</span>
      {lit && (
        <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 py-0.5 text-xs font-bold text-page-bg tabular-nums">
          {unseenCount}
        </span>
      )}
    </button>
  );
}
