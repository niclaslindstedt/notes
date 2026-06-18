import { describe, expect, it } from "vitest";

import { LATEST_VERSION, migrate } from "../../src/storage/migrations.ts";

describe("storage migrations", () => {
  it("treats a document with no version as v0 and migrates it forward", () => {
    const result = migrate({ notes: [] });
    expect(result.data.version).toBe(LATEST_VERSION);
    expect(result.migrated).toBe(true);
  });

  it("guarantees a notes array on a partial legacy document", () => {
    const result = migrate({});
    expect(result.data.notes).toEqual([]);
  });

  it("is a no-op for a document already at the latest version", () => {
    const result = migrate({ version: LATEST_VERSION, notes: [] });
    expect(result.migrated).toBe(false);
  });

  it("throws for a document from a newer build", () => {
    expect(() => migrate({ version: LATEST_VERSION + 1, notes: [] })).toThrow(
      /newer version/,
    );
  });

  it("coerces a non-object input to an empty v0 document", () => {
    const result = migrate("garbage");
    expect(result.data.version).toBe(LATEST_VERSION);
    expect(result.data.notes).toEqual([]);
  });
});
