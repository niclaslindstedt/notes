import { describe, expect, it } from "vitest";

import { createNote } from "../../src/domain/note.ts";
import { LATEST_VERSION } from "../../src/storage/migrations.ts";
import { parse, serialize } from "../../src/storage/serialize.ts";

describe("storage serialize", () => {
  it("round-trips a snapshot through serialize → parse", () => {
    const snapshot = { notes: [createNote(1), createNote(2)] };
    const restored = parse(serialize(snapshot));
    expect(restored.notes).toEqual(snapshot.notes);
  });

  it("stamps the latest version into the bytes", () => {
    const text = serialize({ notes: [] });
    expect(JSON.parse(text).version).toBe(LATEST_VERSION);
  });

  it("falls back to an empty document for null / corrupt bytes", () => {
    expect(parse(null).notes).toEqual([]);
    expect(parse("not json").notes).toEqual([]);
    expect(parse(undefined).notes).toEqual([]);
  });

  it("reads a legacy pre-version document (no version field)", () => {
    const legacy = JSON.stringify({ notes: [createNote(5)] });
    expect(parse(legacy).notes).toHaveLength(1);
  });

  it("drops individual malformed notes rather than failing the load", () => {
    const note = createNote(1);
    const text = JSON.stringify({
      version: LATEST_VERSION,
      notes: [note, { id: "x" }, null, { body: "no id" }],
    });
    expect(parse(text).notes).toEqual([note]);
  });

  it("falls back to empty when the bytes are from a newer build", () => {
    const future = JSON.stringify({ version: 999, notes: [createNote(1)] });
    expect(parse(future).notes).toEqual([]);
  });
});
