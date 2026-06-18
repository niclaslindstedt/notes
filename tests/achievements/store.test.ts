import { describe, expect, it } from "vitest";

import {
  clearUnseenAchievements,
  getAppearance,
  unlockAchievements,
} from "../../src/theme/useTheme.ts";

// The achievement state lives in the synced appearance store. These exercise
// the record/clear helpers the watcher and the unlock modal drive. The store
// is a module singleton, so the steps run in sequence within one test.
describe("appearance achievement helpers", () => {
  it("records, dedupes, and clears unseen unlocks", () => {
    const newly = unlockAchievements(["firstNote", "wordsmith"]);
    expect(newly).toEqual(["firstNote", "wordsmith"]);
    expect(Object.keys(getAppearance().achievements).sort()).toEqual([
      "firstNote",
      "wordsmith",
    ]);
    expect(getAppearance().unseenAchievements).toEqual([
      "firstNote",
      "wordsmith",
    ]);

    // Idempotent: an already-unlocked id is neither re-stamped nor re-queued.
    const again = unlockAchievements(["firstNote"]);
    expect(again).toEqual([]);

    clearUnseenAchievements();
    expect(getAppearance().unseenAchievements).toEqual([]);
    // Clearing the badge leaves the earned trophies intact.
    expect(Object.keys(getAppearance().achievements)).toHaveLength(2);
  });
});
