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

  // A removed feature's history entries stay, but a Learn more link never
  // points at a feature page that is no longer bundled.
  it("offers a Learn more link only to a bundled feature page", () => {
    const items = CHANGELOG.flatMap((r) => r.sections.flatMap((s) => s.items));
    for (const item of items) {
      for (const [, slug] of item.matchAll(/\(feature:([^)\s]+)\)/g)) {
        expect(FEATURE_DOCS[slug!]).toBeDefined();
      }
    }
  });
});
