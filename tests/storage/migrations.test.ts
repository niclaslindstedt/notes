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

  it("v1 → v2 lifts the first body line into a title field", () => {
    const result = migrate({
      version: 1,
      notes: [
        { id: "a", body: "Groceries\n\nmilk\neggs", createdAt: 1, updatedAt: 2 },
      ],
    });
    const note = (result.data.notes as Array<Record<string, unknown>>)[0]!;
    expect(note.title).toBe("Groceries");
    // The title line and the blank line under it are removed from the body.
    expect(note.body).toBe("milk\neggs");
  });

  it("v1 → v2 leaves a body-less note with an empty title", () => {
    const result = migrate({
      version: 1,
      notes: [{ id: "a", body: "", createdAt: 1, updatedAt: 2 }],
    });
    const note = (result.data.notes as Array<Record<string, unknown>>)[0]!;
    expect(note.title).toBe("");
    expect(note.body).toBe("");
  });
});
