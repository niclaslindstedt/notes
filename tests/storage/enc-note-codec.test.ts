import { describe, expect, it } from "vitest";

import {
  encJsonToNote,
  noteToEncJson,
} from "../../src/storage/enc-note-codec.ts";
import type { Note } from "../../src/domain/note.ts";

// A fully-populated note (every optional field set) so the round-trip and
// field-omission assertions exercise the whole shape.
function fullNote(): Note {
  return {
    id: "n1",
    title: "Groceries",
    body: "- milk\n- eggs",
    createdAt: 1000,
    updatedAt: 2000,
    archived: true,
    folderId: "f1",
    attachments: [
      { filename: "a.png", mime: "image/png" },
      { filename: "b.pdf", mime: "application/pdf" },
    ],
  };
}

describe("noteToEncJson", () => {
  it("encodes the required fields", () => {
    const json = noteToEncJson({
      id: "n1",
      title: "Hi",
      body: "world",
      createdAt: 1,
      updatedAt: 2,
    });
    expect(JSON.parse(json)).toEqual({
      id: "n1",
      title: "Hi",
      body: "world",
      createdAt: 1,
      updatedAt: 2,
    });
  });

  it("omits falsy optional fields so the encoding stays stable", () => {
    // archived:false, no folderId, no attachments → none of those keys appear,
    // so an unchanged note never re-hashes differently across saves.
    const json = noteToEncJson({
      id: "n1",
      title: "",
      body: "",
      createdAt: 1,
      updatedAt: 2,
      archived: false,
      folderId: "",
      attachments: [],
    });
    expect(json).toBe(
      '{"id":"n1","title":"","body":"","createdAt":1,"updatedAt":2}',
    );
  });

  it("includes archived, folderId, and attachment metadata when present", () => {
    const obj = JSON.parse(noteToEncJson(fullNote()));
    expect(obj.archived).toBe(true);
    expect(obj.folderId).toBe("f1");
    expect(obj.attachments).toEqual([
      { filename: "a.png", mime: "image/png" },
      { filename: "b.pdf", mime: "application/pdf" },
    ]);
  });

  it("stores attachment metadata only — never the bytes", () => {
    // The bytes live in separate blobs; only filename + mime ride the note JSON.
    const obj = JSON.parse(
      noteToEncJson({
        id: "n1",
        title: "",
        body: "",
        createdAt: 1,
        updatedAt: 2,
        attachments: [{ filename: "a.png", mime: "image/png" }],
      }),
    );
    expect(Object.keys(obj.attachments[0])).toEqual(["filename", "mime"]);
  });
});

describe("encJsonToNote", () => {
  it("round-trips a fully-populated note", () => {
    expect(encJsonToNote(noteToEncJson(fullNote()))).toEqual(fullNote());
  });

  it("round-trips a minimal note", () => {
    const note: Note = {
      id: "n1",
      title: "",
      body: "",
      createdAt: 1,
      updatedAt: 2,
    };
    expect(encJsonToNote(noteToEncJson(note))).toEqual(note);
  });

  it("returns null for malformed JSON", () => {
    expect(encJsonToNote("{not json")).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    expect(encJsonToNote("42")).toBeNull();
    expect(encJsonToNote("null")).toBeNull();
    expect(encJsonToNote('"a string"')).toBeNull();
  });

  it("returns null when a required field is missing or mistyped", () => {
    expect(encJsonToNote('{"id":"n1","body":"b","createdAt":1}')).toBeNull();
    expect(
      encJsonToNote('{"id":1,"body":"b","createdAt":1,"updatedAt":2}'),
    ).toBeNull();
    expect(
      encJsonToNote('{"id":"n1","body":"b","createdAt":"1","updatedAt":2}'),
    ).toBeNull();
  });

  it("defaults a missing/non-string title to empty string", () => {
    const note = encJsonToNote(
      '{"id":"n1","body":"b","createdAt":1,"updatedAt":2}',
    );
    expect(note?.title).toBe("");
  });

  it("drops an empty folderId rather than carrying it", () => {
    const note = encJsonToNote(
      '{"id":"n1","title":"","body":"b","createdAt":1,"updatedAt":2,"folderId":""}',
    );
    expect(note).not.toHaveProperty("folderId");
  });

  it("ignores archived when not exactly true", () => {
    const note = encJsonToNote(
      '{"id":"n1","title":"","body":"b","createdAt":1,"updatedAt":2,"archived":"yes"}',
    );
    expect(note).not.toHaveProperty("archived");
  });

  it("skips malformed attachment entries and drops an all-bad list", () => {
    const note = encJsonToNote(
      JSON.stringify({
        id: "n1",
        title: "",
        body: "b",
        createdAt: 1,
        updatedAt: 2,
        attachments: [
          { filename: "ok.png", mime: "image/png" },
          { filename: "no-mime.png" },
          null,
          "nope",
        ],
      }),
    );
    expect(note?.attachments).toEqual([
      { filename: "ok.png", mime: "image/png" },
    ]);

    const allBad = encJsonToNote(
      JSON.stringify({
        id: "n1",
        title: "",
        body: "b",
        createdAt: 1,
        updatedAt: 2,
        attachments: [{ filename: "no-mime.png" }],
      }),
    );
    expect(allBad).not.toHaveProperty("attachments");
  });
});
