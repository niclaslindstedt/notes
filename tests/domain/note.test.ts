import { describe, expect, it } from "vitest";

import {
  activeNotes,
  archivedNotes,
  createFolder,
  createNote,
  defaultNoteTitle,
  DEFAULT_SAVE_FORMATTING,
  editNote,
  formatBody,
  formatSnapshotForSave,
  isBlank,
  isDefaultTitleScheme,
  noteTitle,
  notePreview,
  notesInFolder,
  retitleNote,
  setArchived,
  setNoteFolder,
  sortByUpdated,
  sortFoldersByCreated,
} from "../../src/domain/note.ts";
import type { Attachment } from "../../src/domain/attachment.ts";

function attach(filename: string): Attachment {
  return { filename, mime: "image/png", data: "data:image/png;base64,AAA" };
}

describe("save formatting", () => {
  const fmt = DEFAULT_SAVE_FORMATTING;

  it("trims trailing spaces from every line", () => {
    expect(formatBody("foo   \nbar\t\nbaz", fmt)).toBe("foo\nbar\nbaz\n");
  });

  it("ensures a single trailing newline without doubling one", () => {
    expect(formatBody("foo", fmt)).toBe("foo\n");
    expect(formatBody("foo\n", fmt)).toBe("foo\n");
    expect(formatBody("foo\n\n", fmt)).toBe("foo\n\n");
  });

  it("leaves an empty body empty", () => {
    expect(formatBody("", fmt)).toBe("");
  });

  it("honours each flag independently", () => {
    expect(
      formatBody("foo  ", { trimTrailingSpaces: true, trailingNewline: false }),
    ).toBe("foo");
    expect(
      formatBody("foo  ", { trimTrailingSpaces: false, trailingNewline: true }),
    ).toBe("foo  \n");
  });

  it("returns the same snapshot reference when nothing changes", () => {
    const snapshot = { notes: [editNote(createNote(0), "tidy\n", 1)] };
    expect(formatSnapshotForSave(snapshot, fmt)).toBe(snapshot);
  });

  it("tidies the bodies that need it across a snapshot", () => {
    const snapshot = {
      notes: [editNote(createNote(0), "needs trim  ", 1)],
    };
    const out = formatSnapshotForSave(snapshot, fmt);
    expect(out).not.toBe(snapshot);
    expect(out.notes[0]!.body).toBe("needs trim\n");
  });
});

describe("note domain", () => {
  it("creates a blank note stamped at the given time", () => {
    const note = createNote(1000);
    expect(note.title).toBe("");
    expect(note.body).toBe("");
    expect(note.createdAt).toBe(1000);
    expect(note.updatedAt).toBe(1000);
    expect(isBlank(note)).toBe(true);
  });

  it("shows the title field, trimmed, and previews the whole body", () => {
    const titled = retitleNote(createNote(0), "  Hello world  ", 1);
    const note = editNote(titled, "first\nmore", 2);
    expect(noteTitle(note)).toBe("Hello world");
    expect(notePreview(note)).toBe("first more");
  });

  it("strips image-attachment markdown from the preview", () => {
    const note = editNote(
      createNote(0),
      "before\n![photo.png](attachments/photo.png)\nafter",
      1,
    );
    expect(notePreview(note)).toBe("before after");
    const inline = editNote(
      createNote(0),
      "see ![shot](attachments/shot.png) here",
      1,
    );
    expect(notePreview(inline)).toBe("see here");
  });

  it("prunes attachments whose body reference was erased", () => {
    const withImage = editNote(
      { ...createNote(0), attachments: [attach("a.png"), attach("b.png")] },
      "![a](attachments/a.png)\n![b](attachments/b.png)",
      1,
    );
    expect(withImage.attachments?.map((a) => a.filename)).toEqual([
      "a.png",
      "b.png",
    ]);

    const afterDelete = editNote(withImage, "![a](attachments/a.png)", 2);
    expect(afterDelete.attachments?.map((a) => a.filename)).toEqual(["a.png"]);

    const afterClear = editNote(afterDelete, "just text", 3);
    expect(afterClear.attachments).toBeUndefined();
  });

  it("falls back to a placeholder title for a title-less note", () => {
    expect(noteTitle(createNote(0))).toBe("Untitled note");
    expect(noteTitle(editNote(createNote(0), "body only", 1))).toBe(
      "Untitled note",
    );
  });

  it("trims the title on retitle so it never starts or ends with a space", () => {
    expect(retitleNote(createNote(0), "  Hello world  ", 1).title).toBe(
      "Hello world",
    );
    expect(retitleNote(createNote(0), "\tTabbed\n", 1).title).toBe("Tabbed");
    expect(retitleNote(createNote(0), "   ", 1).title).toBe("");
  });

  it("bumps updatedAt on edit / retitle without touching createdAt", () => {
    const note = editNote(createNote(100), "hi", 200);
    expect(note.createdAt).toBe(100);
    expect(note.updatedAt).toBe(200);
    expect(isBlank(note)).toBe(false);
    const renamed = retitleNote(createNote(100), "Title", 300);
    expect(renamed.createdAt).toBe(100);
    expect(renamed.updatedAt).toBe(300);
    expect(isBlank(renamed)).toBe(false);
  });

  it("leaves updatedAt untouched when the body is unchanged", () => {
    const note = editNote(createNote(100), "hi", 200);
    const reEdited = editNote(note, "hi", 999);
    expect(reEdited.updatedAt).toBe(200);
    // An unchanged body is a no-op, so the same note instance comes back.
    expect(reEdited).toBe(note);
  });

  it("archives and restores without bumping updatedAt or mutating the input", () => {
    const note = editNote(createNote(100), "hi", 200);
    const archived = setArchived(note, true);
    expect(archived.archived).toBe(true);
    expect(archived.updatedAt).toBe(200);
    expect(note.archived).toBeUndefined();
    const restored = setArchived(archived, false);
    expect(restored.archived).toBe(false);
    expect(restored.updatedAt).toBe(200);
  });

  it("partitions notes into active and archived", () => {
    const a = editNote(createNote(0), "a", 10);
    const b = setArchived(editNote(createNote(0), "b", 20), true);
    const c = editNote(createNote(0), "c", 30);
    const notes = [a, b, c];
    expect(activeNotes(notes).map((n) => n.body)).toEqual(["a", "c"]);
    expect(archivedNotes(notes).map((n) => n.body)).toEqual(["b"]);
  });

  it("validates the default-title scheme", () => {
    expect(isDefaultTitleScheme("none")).toBe(true);
    expect(isDefaultTitleScheme("dateTime")).toBe(true);
    expect(isDefaultTitleScheme("numbered")).toBe(true);
    expect(isDefaultTitleScheme("nope")).toBe(false);
    expect(isDefaultTitleScheme(undefined)).toBe(false);
  });

  it("leaves the title empty under the 'none' scheme", () => {
    expect(defaultNoteTitle("none", [])).toBe("");
  });

  it("stamps a local YYYY-MM-DD HH:mm title under the 'dateTime' scheme", () => {
    const now = new Date(2026, 5, 19, 16, 44).getTime();
    expect(defaultNoteTitle("dateTime", [], now)).toBe("2026-06-19 16:44");
  });

  it("picks the next free 'Note N' under the 'numbered' scheme", () => {
    const note = (title: string) => retitleNote(createNote(0), title, 1);
    expect(defaultNoteTitle("numbered", [])).toBe("Note");
    expect(defaultNoteTitle("numbered", [note("Note")])).toBe("Note 2");
    expect(defaultNoteTitle("numbered", [note("Note"), note("Note 2")])).toBe(
      "Note 3",
    );
    // Gaps and unrelated titles don't throw the count off — it tracks the max.
    expect(
      defaultNoteTitle("numbered", [note("Note 5"), note("Groceries")]),
    ).toBe("Note 6");
  });

  it("sorts most-recently-edited first without mutating the input", () => {
    const a = editNote(createNote(0), "a", 10);
    const b = editNote(createNote(0), "b", 30);
    const c = editNote(createNote(0), "c", 20);
    const input = [a, b, c];
    const sorted = sortByUpdated(input);
    expect(sorted.map((n) => n.body)).toEqual(["b", "c", "a"]);
    expect(input.map((n) => n.body)).toEqual(["a", "b", "c"]);
  });
});

describe("folders", () => {
  it("creates a folder with a trimmed name, a stable id, and a timestamp", () => {
    const folder = createFolder("  Login feature  ", 123);
    expect(folder.name).toBe("Login feature");
    expect(folder.createdAt).toBe(123);
    expect(folder.id).toMatch(/.+/);
    // Two folders never share an id.
    expect(createFolder("a").id).not.toBe(createFolder("a").id);
  });

  it("files a note into a folder without bumping updatedAt", () => {
    const original = editNote(createNote(0), "body", 10);
    const filed = setNoteFolder(original, "folder-1");
    expect(filed.folderId).toBe("folder-1");
    expect(filed.updatedAt).toBe(10);
    expect(original.folderId).toBeUndefined();
  });

  it("removes a note from its folder when given null/undefined", () => {
    const filed = setNoteFolder(createNote(0), "folder-1");
    const ungrouped = setNoteFolder(filed, null);
    expect(ungrouped.folderId).toBeUndefined();
    expect(setNoteFolder(filed, undefined).folderId).toBeUndefined();
  });

  it("returns the same reference when the folder doesn't change", () => {
    const note = createNote(0);
    expect(setNoteFolder(note, null)).toBe(note);
    const filed = setNoteFolder(note, "folder-1");
    expect(setNoteFolder(filed, "folder-1")).toBe(filed);
  });

  it("sorts folders by creation order without mutating the input", () => {
    const a = createFolder("a", 30);
    const b = createFolder("b", 10);
    const c = createFolder("c", 20);
    const input = [a, b, c];
    expect(sortFoldersByCreated(input).map((f) => f.name)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(input.map((f) => f.name)).toEqual(["a", "b", "c"]);
  });

  it("partitions notes into a folder and the ungrouped remainder", () => {
    const inFolder = setNoteFolder(createNote(0), "f1");
    const elsewhere = setNoteFolder(createNote(0), "f2");
    const loose = createNote(0);
    const notes = [inFolder, elsewhere, loose];
    expect(notesInFolder(notes, "f1")).toEqual([inFolder]);
    expect(notesInFolder(notes, null)).toEqual([loose]);
  });
});
