// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { buildSeed, SEED_VERSION, seedDevData } from "../../src/dev/seed.ts";
import { parse } from "../../src/storage/serialize.ts";
import {
  getNamespaces,
  namespaceLocalKey,
  parseNamespaces,
} from "../../src/storage/namespaces.ts";

afterEach(() => {
  localStorage.clear();
});

describe("buildSeed", () => {
  it("builds several namespaces with the default first", () => {
    const seeded = buildSeed();
    expect(seeded.length).toBeGreaterThan(1);
    expect(seeded[0]?.namespace.slug).toBe("default");
    // Slugs are unique.
    const slugs = seeded.map((s) => s.namespace.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("varies note length, title and archived state", () => {
    const allNotes = buildSeed().flatMap((s) => s.snapshot.notes);
    expect(allNotes.length).toBeGreaterThan(10);
    // A mix of empty and non-empty titles.
    expect(allNotes.some((n) => n.title === "")).toBe(true);
    expect(allNotes.some((n) => n.title !== "")).toBe(true);
    // Both short and long bodies are present.
    expect(Math.min(...allNotes.map((n) => n.body.length))).toBeLessThan(80);
    expect(Math.max(...allNotes.map((n) => n.body.length))).toBeGreaterThan(
      400,
    );
    // At least one archived note.
    expect(allNotes.some((n) => n.archived)).toBe(true);
  });

  it("stamps timestamps relative to the supplied `now`", () => {
    const now = 1_700_000_000_000;
    for (const { snapshot } of buildSeed(now)) {
      for (const note of snapshot.notes) {
        expect(note.createdAt).toBeLessThanOrEqual(now);
        expect(note.updatedAt).toBeLessThanOrEqual(now);
      }
    }
  });
});

describe("seedDevData", () => {
  it("writes the registry and a document per namespace, round-tripping cleanly", () => {
    expect(seedDevData()).toBe(true);

    const namespaces = getNamespaces();
    const expected = buildSeed();
    expect(namespaces.map((n) => n.slug)).toEqual(
      expected.map((s) => s.namespace.slug),
    );

    for (const { namespace } of expected) {
      const raw = localStorage.getItem(namespaceLocalKey(namespace.slug));
      expect(raw).not.toBeNull();
      // The stored text parses back through the real load pipeline.
      expect(parse(raw).notes.length).toBeGreaterThan(0);
    }

    // The registry is stored under the key the namespace store reads.
    expect(
      parseNamespaces(localStorage.getItem("notes:namespaces")).length,
    ).toBe(expected.length);
  });

  it("seeds once per version, then forces a re-seed on demand", () => {
    expect(seedDevData()).toBe(true);
    expect(localStorage.getItem("notes:dev:seeded")).toBe(SEED_VERSION);
    // Second call is a no-op (sentinel matches the current version).
    expect(seedDevData()).toBe(false);
    // `force` re-seeds regardless.
    expect(seedDevData({ force: true })).toBe(true);
  });
});
