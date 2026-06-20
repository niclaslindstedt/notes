import { describe, expect, it } from "vitest";

import { buildSeedSnapshot } from "../../src/dev/seed.ts";
import { createDevSeedAdapter } from "../../src/storage/dev-seed/index.ts";
import { parse } from "../../src/storage/serialize.ts";

describe("buildSeedSnapshot", () => {
  it("flattens every seeded namespace into one document", () => {
    const snapshot = buildSeedSnapshot();
    expect(snapshot.notes.length).toBeGreaterThan(10);
    // Distinct ids — the flattened notes don't collide.
    const ids = snapshot.notes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("createDevSeedAdapter", () => {
  it("loads a non-empty sample document without a sync fast path", async () => {
    const adapter = createDevSeedAdapter();
    // No sync capability — it must never be the first-paint adapter.
    expect(adapter.capabilities.has("loadSync")).toBe(false);
    expect(adapter.loadSync).toBeUndefined();

    const loaded = await adapter.load();
    expect(loaded).not.toBeNull();
    expect(parse(loaded!.text).notes.length).toBeGreaterThan(0);
  });

  it("round-trips edits in memory only", async () => {
    const adapter = createDevSeedAdapter();
    const next = '{"version":3,"notes":[]}\n';
    const saved = await adapter.save(next);
    expect(saved.text).toBe(next);
    // The same instance reads back what was saved...
    expect((await adapter.load())!.text).toBe(next);
    // ...but a fresh instance starts from a pristine sample again.
    const fresh = createDevSeedAdapter();
    expect(parse((await fresh.load())!.text).notes.length).toBeGreaterThan(0);
  });
});
