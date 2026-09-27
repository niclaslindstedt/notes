// Barrel for the achievements feature: the catalog, the manual-unlock bus,
// the watcher, the pure derive helper, and the shared types / tier constants.

import { useAchievementWatcher as watchAchievements } from "./useAchievementWatcher.ts";

export { ACHIEVEMENTS, ACHIEVEMENT_BY_ID } from "./catalog.ts";
export { unlock } from "./bus.ts";
export { deriveUnlocks } from "./derive.ts";
export type { AchievementWatcher } from "./useAchievementWatcher.ts";
// The phone and desktop builds (`__EMBEDDED__`) ship without achievements —
// no Nird native build has them (the website does). The watcher is swapped for
// a no-op at compile time, so it, the catalog and the predicates it reads
// never reach those bundles.
export const useAchievementWatcher: typeof watchAchievements = __EMBEDDED__
  ? () => {}
  : watchAchievements;
export { TIER_POINTS, TIER_ORDER } from "./types.ts";
export type {
  Achievement,
  AchievementTier,
  AchState,
  Trigger,
} from "./types.ts";
export type { Glyph } from "./glyphs.tsx";
