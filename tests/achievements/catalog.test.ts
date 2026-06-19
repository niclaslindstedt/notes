import { describe, expect, it } from "vitest";

import {
  ACHIEVEMENTS,
  ACHIEVEMENT_BY_ID,
} from "../../src/achievements/catalog.ts";
import { TIER_ORDER } from "../../src/achievements/types.ts";

describe("achievement catalog", () => {
  it("has unique, non-empty ids", () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every entry a name and condition", () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.condition.length).toBeGreaterThan(0);
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
