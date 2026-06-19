import { ACHIEVEMENT_BY_ID, TIER_POINTS } from "../../achievements/index.ts";
import { TrophyGlyph } from "../../achievements/glyphs.tsx";
import { useT, type MessageKey } from "../../i18n/index.ts";
import { CloseIcon } from "../icons.tsx";
import { Modal } from "../Modal.tsx";

// Pops up when the user taps the lit trophy button. Lists every unlock they
// haven't acknowledged yet, in queue order — NOT the full four-tier tour.
// Closing it (X, backdrop, or "Awesome!") clears the unseen queue so the
// trophy returns to its quiet state. Renders as a compact centered card (not
// the full-screen mobile sheet): the list of fresh unlocks is short and opens
// no soft keyboard.

type Props = {
  open: boolean;
  unseenIds: readonly string[];
  onClose: () => void;
};

export function AchievementUnlockModal({ open, unseenIds, onClose }: Props) {
  const t = useT();
  const items = unseenIds
    .map((id) => ACHIEVEMENT_BY_ID.get(id))
    .filter((a): a is NonNullable<typeof a> => a !== undefined);
  if (!open || items.length === 0) return null;
  const title =
    items.length === 1
      ? t("achievements.unlockModal.titleOne")
      : t("achievements.unlockModal.titleOther", { n: items.length });

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="achievement-unlock-title"
      centered
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-surface-3 px-4 py-3">
        <h2
          id="achievement-unlock-title"
          className="flex items-center gap-2 text-sm font-bold tracking-wide text-fg-bright"
        >
          <TrophyGlyph className="h-4 w-4 text-accent" />
          {title}
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
        <div className="flex flex-col gap-2">
          {items.map((ach) => {
            const Icon = ach.glyph;
            return (
              <article
                key={ach.id}
                className="flex items-start gap-3 rounded border border-line bg-surface-2 px-3 py-2"
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-accent bg-accent/15 text-accent">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <div className="flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-bold text-fg-bright">
                      {t(`achievements.catalog.${ach.id}.name` as MessageKey)}
                    </span>
                    <span className="text-xs text-muted">
                      +{TIER_POINTS[ach.tier]}
                    </span>
                  </div>
                  <p className="text-xs text-muted">
                    {t(
                      `achievements.catalog.${ach.id}.condition` as MessageKey,
                    )}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-end border-t border-line bg-surface-3 px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded border border-accent bg-accent/15 px-4 py-1.5 text-sm font-medium text-accent hover:bg-accent/25 focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
        >
          {t("achievements.unlockModal.dismiss")}
        </button>
      </footer>
    </Modal>
  );
}
