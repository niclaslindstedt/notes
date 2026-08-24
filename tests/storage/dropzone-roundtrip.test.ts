import { describe, expect, it } from "vitest";

import { createDropzoneNote, type Note } from "../../src/domain/note.ts";
import {
  encJsonToNote,
  noteToEncJson,
} from "../../src/storage/enc-note-codec.ts";
import { noteToMarkdown, parseNote } from "../../src/storage/markdown/codec.ts";
import {
  indexEntryToNote,
  noteToIndexEntry,
  parseIndex,
  serializeIndex,
} from "../../src/storage/note-index.ts";
import { parse, serialize } from "../../src/storage/serialize.ts";

// A dropzone note is only useful because it reaches the user's *other*
// devices, so the flag has to survive every shape the note is stored in: the
// JSON document (browser backend), one markdown file per note (folder / cloud),
// the per-note encrypted blob, and the encrypted index the lazy load rebuilds
// the list from. Losing it anywhere would resurface the note among the ordinary
// notes on the other device.
const made = createDropzoneNote(new Date(2025, 2, 4, 17, 9).getTime());
const plain: Note = { ...made, dropzone: undefined, title: "Groceries" };

describe("the dropzone flag round-trips through", () => {
  it("the JSON document", () => {
    expect(parse(serialize({ notes: [made] })).notes[0]!.dropzone).toBe(true);
    expect("dropzone" in parse(serialize({ notes: [plain] })).notes[0]!).toBe(
      false,
    );
  });

  it("a markdown file", () => {
    const text = noteToMarkdown(made);
    expect(text).toContain("dropzone: true");
    expect(parseNote(text)!.dropzone).toBe(true);
    // An ordinary note's frontmatter stays exactly as minimal as it was.
    expect(noteToMarkdown(plain)).not.toContain("dropzone");
    expect(parseNote(noteToMarkdown(plain))!.dropzone).toBeUndefined();
  });

  it("an encrypted note blob", () => {
    expect(encJsonToNote(noteToEncJson(made))!.dropzone).toBe(true);
    expect(encJsonToNote(noteToEncJson(plain))!.dropzone).toBeUndefined();
  });

  it("the encrypted note index", () => {
    const entries = parseIndex(serializeIndex([noteToIndexEntry(made)]));
    expect(indexEntryToNote(entries![0]!).dropzone).toBe(true);
    const ordinary = parseIndex(serializeIndex([noteToIndexEntry(plain)]));
    expect(indexEntryToNote(ordinary![0]!).dropzone).toBeUndefined();
  });
});
