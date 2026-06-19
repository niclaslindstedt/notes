import {
  ACHIEVEMENTS,
  TIER_ORDER,
  TIER_POINTS,
  type Achievement,
  type AchievementTier,
} from "../../achievements/index.ts";
import {
  CompassGlyph,
  type Glyph,
  LockGlyph,
  SproutGlyph,
  TrophyGlyph,
  WandGlyph,
  WorkflowGlyph,
} from "../../achievements/glyphs.tsx";
import { useT, type MessageKey, type TFunction } from "../../i18n/index.ts";
import { CheckIcon, CloseIcon } from "../icons.tsx";
import { Modal } from "../Modal.tsx";

// The in-app achievements tour: a four-tier (Beginner → Intermediate → Pro →
// Expert) browse of the whole catalog, every feature an unlockable trophy.
// Reads the unlocked map straight from the synced appearance settings passed
// in from App, so it stays correct under any storage backend. Display copy is
// resolved by achievement id through the `achievements` i18n namespace.

type UnlockedMap = Record<string, number>;

const TIER_GLYPH: Record<AchievementTier, Glyph> = {
  beginner: SproutGlyph,
  intermediate: CompassGlyph,
  pro: WorkflowGlyph,
  expert: WandGlyph,
};

type Props = {
  open: boolean;
  onClose: () => void;
  unlocked: UnlockedMap;
};

export function AchievementsModal({ open, onClose, unlocked }: Props) {
  const t = useT();

  const knownIds = Object.keys(unlocked).filter((id) =>
    ACHIEVEMENTS.some((a) => a.id === id),
  );
  const totalPoints = knownIds.reduce((sum, id) => {
    const ach = ACHIEVEMENTS.find((a) => a.id === id);
    return ach ? sum + TIER_POINTS[ach.tier] : sum;
  }, 0);
  const maxPoints = ACHIEVEMENTS.reduce(
    (sum, a) => sum + TIER_POINTS[a.tier],
    0,
  );
  const unlockedCount = knownIds.length;

  return (
    <Modal open={open} onClose={onClose} labelledBy="achievements-title">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-surface-3 px-4 py-3">
        <h2
          id="achievements-title"
          className="flex items-center gap-2 text-sm font-bold tracking-wide text-fg-bright"
        >
          <TrophyGlyph className="h-4 w-4 text-accent" />
          {t("achievements.modal.title")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="-mr-1 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </header>

      <div className="flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4 text-sm">
        <div className="flex flex-col gap-8 leading-relaxed">
          <header className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded border border-accent bg-accent/15 text-accent">
              <TrophyGlyph className="h-5 w-5" />
            </span>
            <p className="flex-1 text-xs text-muted">
              {t("achievements.modal.counter", {
                unlocked: unlockedCount,
                total: ACHIEVEMENTS.length,
                earned: totalPoints,
                max: maxPoints,
              })}
            </p>
          </header>

          <p>{t("achievements.modal.intro")}</p>

          {TIER_ORDER.map((tier) => (
            <TierSection
              key={tier}
              tier={tier}
              t={t}
              unlocked={unlocked}
              achievements={ACHIEVEMENTS.filter((a) => a.tier === tier)}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}

function TierSection({
  tier,
  achievements,
  unlocked,
  t,
}: {
  tier: AchievementTier;
  achievements: readonly Achievement[];
  unlocked: UnlockedMap;
  t: TFunction;
}) {
  const Icon = TIER_GLYPH[tier];
  const points = TIER_POINTS[tier];
  const tierMax = achievements.length * points;
  const tierEarned =
    achievements.filter((a) => unlocked[a.id] !== undefined).length * points;
  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-line bg-surface-2 text-link">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="flex flex-col">
          <h3 className="text-base font-bold tracking-wide text-fg-bright">
            {t(`achievements.modal.tier.${tier}.title` as MessageKey)}{" "}
            <span className="text-xs font-normal text-muted">
              {tierEarned}/{tierMax} points
            </span>
          </h3>
          <p className="text-xs text-muted">
            {t(`achievements.modal.tier.${tier}.subtitle` as MessageKey)}
          </p>
        </div>
      </header>
      <div className="flex flex-col gap-2">
        {achievements.map((ach) => (
          <AchievementRow
            key={ach.id}
            achievement={ach}
            unlockedAt={unlocked[ach.id]}
            t={t}
          />
        ))}
      </div>
    </section>
  );
}

function AchievementRow({
  achievement,
  unlockedAt,
  t,
}: {
  achievement: Achievement;
  unlockedAt: number | undefined;
  t: TFunction;
}) {
  const Icon = achievement.glyph;
  const isUnlocked = unlockedAt !== undefined;
  const points = TIER_POINTS[achievement.tier];
  const name = t(`achievements.catalog.${achievement.id}.name` as MessageKey);
  const condition = t(
    `achievements.catalog.${achievement.id}.condition` as MessageKey,
  );
  const learnMore = achievement.learnMore
    ? t(`achievements.catalog.${achievement.id}.learnMore` as MessageKey)
    : null;
  return (
    <details
      className={
        isUnlocked
          ? "group rounded border border-line bg-surface px-3 py-2 open:bg-surface-2"
          : "group rounded border border-line bg-surface/60 px-3 py-2 open:bg-surface-2"
      }
    >
      <summary className="flex cursor-pointer list-none items-start gap-2">
        <span
          className={
            isUnlocked
              ? "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-accent bg-accent/15 text-accent"
              : "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line bg-surface-2 text-muted"
          }
          aria-label={isUnlocked ? undefined : t("achievements.modal.locked")}
        >
          {isUnlocked ? (
            <Icon className="h-[14px] w-[14px]" />
          ) : (
            <LockGlyph className="h-3 w-3" />
          )}
        </span>
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <span
              className={
                isUnlocked
                  ? "text-sm font-bold text-fg-bright"
                  : "text-sm font-bold text-muted"
              }
            >
              {name}
            </span>
            <span className="text-xs text-muted">+{points}</span>
            {isUnlocked && <CheckIcon className="h-3 w-3 text-accent" />}
          </div>
          <p className={isUnlocked ? "text-xs text-fg" : "text-xs text-muted"}>
            {condition}
          </p>
          {learnMore ? (
            <span className="text-xs text-link group-open:hidden">
              {t("achievements.modal.learnMore")}
            </span>
          ) : null}
        </div>
      </summary>
      {learnMore ? (
        <div className="mt-2 ml-8 text-muted">{learnMore}</div>
      ) : null}
    </details>
  );
}
