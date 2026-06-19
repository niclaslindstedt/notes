import { describe, expect, it } from "vitest";

import {
  ACHIEVEMENTS,
  ACHIEVEMENT_BY_ID,
} from "../../src/achievements/catalog.ts";
import { TIER_ORDER } from "../../src/achievements/types.ts";
import enAchievements from "../../src/i18n/locales/en/achievements.ts";

describe("achievement catalog", () => {
  it("has unique, non-empty ids", () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has i18n name and condition copy for every entry", () => {
    const catalog = enAchievements.catalog as Record<
      string,
      { name: string; condition: string; learnMore?: string }
    >;
    for (const a of ACHIEVEMENTS) {
      const copy = catalog[a.id];
      expect(copy, `missing i18n copy for "${a.id}"`).toBeTruthy();
      expect(copy!.name.length).toBeGreaterThan(0);
      expect(copy!.condition.length).toBeGreaterThan(0);
      // The `learnMore?: boolean` flag on the entry must agree with the
      // presence of learnMore copy in the catalog.
      expect(Boolean(a.learnMore)).toBe(typeof copy!.learnMore === "string");
    }
  });

  it("places every entry in a known tier", () => {
    for (const a of ACHIEVEMENTS) {
      expect(TIER_ORDER).toContain(a.tier);
    }
  });

  it("indexes every entry in ACHIEVEMENT_BY_ID", () => {
    expect(ACHIEVEMENT_BY_ID.size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) {
      expect(ACHIEVEMENT_BY_ID.get(a.id)).toBe(a);
    }
  });

  it("includes a completionist trophy", () => {
    expect(ACHIEVEMENT_BY_ID.has("completionist")).toBe(true);
  });
});
