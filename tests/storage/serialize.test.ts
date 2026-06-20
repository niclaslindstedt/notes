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

describe("storage serialize — folders", () => {
  it("round-trips folders and note.folderId through serialize → parse", () => {
    const note = { ...createNote(1), folderId: "f1" };
    const folder = { id: "f1", name: "Login feature", createdAt: 5 };
    const snapshot = { notes: [note], folders: [folder] };
    const restored = parse(serialize(snapshot));
    expect(restored.notes[0]?.folderId).toBe("f1");
    expect(restored.folders).toEqual([folder]);
  });

  it("omits the folders key when there are none", () => {
    const restored = parse(serialize({ notes: [createNote(1)] }));
    expect(restored.folders).toBeUndefined();
  });

  it("drops a malformed folder and a non-string folderId defensively", () => {
    const text = JSON.stringify({
      version: LATEST_VERSION,
      notes: [{ ...createNote(1), folderId: 42 }],
      folders: [
        { id: "ok", name: "Keep", createdAt: 1 },
        { id: "", name: "no id", createdAt: 1 },
        { name: "missing id", createdAt: 1 },
        null,
        { id: "ok", name: "dup", createdAt: 2 },
      ],
    });
    const restored = parse(text);
    expect(restored.notes[0]?.folderId).toBeUndefined();
    expect(restored.folders).toEqual([
      { id: "ok", name: "Keep", createdAt: 1 },
    ]);
  });
});
