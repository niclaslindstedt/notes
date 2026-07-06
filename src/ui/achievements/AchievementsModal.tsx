import { AchievementsModal as FrameworkAchievementsModal } from "@niclaslindstedt/oss-framework/achievements";

import { useT } from "../../i18n/index.ts";
import { useAchievementDisplay } from "./display.ts";

// The in-app achievements tour: a four-tier (Beginner → Intermediate → Pro →
// Expert) browse of the whole catalog, every feature an unlockable trophy.
// The framework modal owns the layout, the tier sections, and the
// locked/unlocked treatment; this wrapper feeds it the app's catalog
// (display copy resolved by achievement id through the `achievements` i18n
// namespace), the unlocked map from the synced appearance settings, and the
// translated chrome strings.

type UnlockedMap = Record<string, number>;

type Props = {
  open: boolean;
  onClose: () => void;
  unlocked: UnlockedMap;
};

export function AchievementsModal({ open, onClose, unlocked }: Props) {
  const t = useT();
  const achievements = useAchievementDisplay();
  return (
    <FrameworkAchievementsModal
      open={open}
      onClose={onClose}
      achievements={achievements}
      unlocked={unlocked}
      labels={{
        title: t("achievements.modal.title"),
        intro: t("achievements.modal.intro"),
        locked: t("achievements.modal.locked"),
        learnMore: t("achievements.modal.learnMore"),
        close: t("common.close"),
        counter: ({ unlocked: u, total, earned, max }) =>
          t("achievements.modal.counter", {
            unlocked: u,
            total,
            earned,
            max,
          }),
        tierPoints: ({ earned, max }) => `${earned}/${max} points`,
        tier: {
          beginner: {
            title: t("achievements.modal.tier.beginner.title"),
            subtitle: t("achievements.modal.tier.beginner.subtitle"),
          },
          intermediate: {
            title: t("achievements.modal.tier.intermediate.title"),
            subtitle: t("achievements.modal.tier.intermediate.subtitle"),
          },
          pro: {
            title: t("achievements.modal.tier.pro.title"),
            subtitle: t("achievements.modal.tier.pro.subtitle"),
          },
          expert: {
            title: t("achievements.modal.tier.expert.title"),
            subtitle: t("achievements.modal.tier.expert.subtitle"),
          },
        },
      }}
    />
  );
}
