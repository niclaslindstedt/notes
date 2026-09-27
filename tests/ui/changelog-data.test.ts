import { describe, expect, it } from "vitest";

import {
  CHANGELOG,
  dropDeadFeatureLinks,
} from "../../src/ui/changelog/data.ts";
import { FEATURE_DOCS } from "../../src/ui/changelog/feature-docs.ts";

describe("changelog feature links", () => {
  it("keeps a Learn more link whose feature doc is bundled", () => {
    const item = "**Namespaces** — Keep notes apart. [Learn more](feature:ns)";
    expect(dropDeadFeatureLinks(item, { ns: {} })).toBe(item);
  });

  it("drops a Learn more link whose doc is left out, and keeps the entry", () => {
    expect(
      dropDeadFeatureLinks(
        "**Self-hosted sync** — Pair a server. [Learn more](feature:gone)",
        {},
      ),
    ).toBe("**Self-hosted sync** — Pair a server.");
  });

  // notesd was removed, so its history entries stay but point nowhere.
  it("offers no link to the removed notesd feature page", () => {
    expect(FEATURE_DOCS.notesd).toBeUndefined();
    const items = CHANGELOG.flatMap((r) => r.sections.flatMap((s) => s.items));
    expect(items.some((i) => i.includes("feature:notesd"))).toBe(false);
    for (const item of items) {
      for (const [, slug] of item.matchAll(/\(feature:([^)\s]+)\)/g)) {
        expect(FEATURE_DOCS[slug!]).toBeDefined();
      }
    }
  });
});
