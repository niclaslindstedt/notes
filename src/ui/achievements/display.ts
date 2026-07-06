import { useMemo } from "react";

import type { AchievementDisplay } from "@niclaslindstedt/oss-framework/achievements";

import { ACHIEVEMENTS } from "../../achievements/index.ts";
import { useT, type MessageKey } from "../../i18n/index.ts";

// The catalog projected into the display view the framework's achievements
// modals render: each entry's copy (name / condition / learnMore) resolved
// by achievement id through the `achievements` i18n namespace.
export function useAchievementDisplay(): readonly AchievementDisplay[] {
  const t = useT();
  return useMemo(
    () =>
      ACHIEVEMENTS.map((a) => ({
        id: a.id,
        tier: a.tier,
        glyph: a.glyph,
        name: t(`achievements.catalog.${a.id}.name` as MessageKey),
        condition: t(`achievements.catalog.${a.id}.condition` as MessageKey),
        learnMore: a.learnMore
          ? t(`achievements.catalog.${a.id}.learnMore` as MessageKey)
          : undefined,
      })),
    [t],
  );
}
