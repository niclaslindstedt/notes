import { describe, expect, it } from "vitest";

import { createNote, type Note } from "../../src/domain/note.ts";
import {
  indexEntryToNote,
  noteToIndexEntry,
  parseIndex,
  serializeIndex,
} from "../../src/storage/note-index.ts";

describe("note-index", () => {
  it("builds an index row from a loaded note (metadata + preview, no body)", () => {
    const note: Note = {
      ...createNote(1),
      title: "Groceries",
      body: "milk\neggs\nbread",
      folderId: "f1",
      attachments: [{ filename: "a.png", mime: "image/png", data: "data:…" }],
    };
    const entry = noteToIndexEntry(note, "rev-7");
    expect(entry.id).toBe(note.id);
    expect(entry.title).toBe("Groceries");
    expect(entry.preview).toContain("milk");
    expect(entry.folderId).toBe("f1");
    // Attachment metadata only — never the bytes.
    expect(entry.attachments).toEqual([
      { filename: "a.png", mime: "image/png" },
    ]);
    expect(entry.rev).toBe("rev-7");
    expect("body" in entry).toBe(false);
  });

  it("rebuilds a deferred note from an index row (body undefined, preview set)", () => {
    const note: Note = {
      ...createNote(2),
      title: "Trip",
      body: "pack the bags",
      archived: true,
    };
    const back = indexEntryToNote(noteToIndexEntry(note));
    expect(back.id).toBe(note.id);
    expect(back.title).toBe("Trip");
    expect(back.body).toBeUndefined();
    expect(back.preview).toContain("pack the bags");
    expect(back.archived).toBe(true);
  });

  it("round-trips through serialize / parse", () => {
    const notes: Note[] = [
      { ...createNote(1), title: "One", body: "first" },
      { ...createNote(2), title: "Two", body: "second", folderId: "f9" },
    ];
    const entries = notes.map((n) => noteToIndexEntry(n, `rev-${n.id}`));
    const parsed = parseIndex(serializeIndex(entries));
    expect(parsed).toEqual(entries);
  });

  it("returns null for malformed or unknown index bytes, dropping bad rows", () => {
    expect(parseIndex(null)).toBeNull();
    expect(parseIndex("not json")).toBeNull();
    expect(parseIndex(JSON.stringify({ v: "other", entries: [] }))).toBeNull();
    // A bad row is dropped, the good ones survive.
    const good = noteToIndexEntry({ ...createNote(1), body: "ok" });
    const parsed = parseIndex(
      JSON.stringify({ v: "notes.index.v1", entries: [good, { id: 5 }] }),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed![0]!.id).toBe(good.id);
  });
});
