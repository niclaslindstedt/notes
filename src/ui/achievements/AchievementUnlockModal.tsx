import { AchievementUnlockModal as FrameworkAchievementUnlockModal } from "@niclaslindstedt/oss-framework/achievements";

import { useT } from "../../i18n/index.ts";
import { useAchievementDisplay } from "./display.ts";

// Pops up when the user taps the lit trophy row. Lists every unlock they
// haven't acknowledged yet, in queue order — NOT the full four-tier tour.
// Closing it (X, backdrop, or "Awesome!") clears the unseen queue. The
// framework modal owns the card; this wrapper feeds it the app's catalog
// view and translated strings.

type Props = {
  open: boolean;
  unseenIds: readonly string[];
  onClose: () => void;
};

export function AchievementUnlockModal({ open, unseenIds, onClose }: Props) {
  const t = useT();
  const achievements = useAchievementDisplay();
  return (
    <FrameworkAchievementUnlockModal
      open={open}
      onClose={onClose}
      achievements={achievements}
      unseenIds={unseenIds}
      labels={{
        titleOne: t("achievements.unlockModal.titleOne"),
        titleOther: (n) => t("achievements.unlockModal.titleOther", { n }),
        dismiss: t("achievements.unlockModal.dismiss"),
        close: t("common.close"),
      }}
    />
  );
}
