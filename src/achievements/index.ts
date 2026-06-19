// Barrel for the achievements feature: the catalog, the manual-unlock bus,
// the watcher, the pure derive helper, and the shared types / tier constants.

export { ACHIEVEMENTS, ACHIEVEMENT_BY_ID } from "./catalog.ts";
export { unlock } from "./bus.ts";
export { deriveUnlocks } from "./derive.ts";
export {
  useAchievementWatcher,
  type AchievementWatcher,
} from "./useAchievementWatcher.ts";
export { TIER_POINTS, TIER_ORDER } from "./types.ts";
export type {
  Achievement,
  AchievementTier,
  AchState,
  Trigger,
} from "./types.ts";
export type { Glyph } from "./glyphs.tsx";
