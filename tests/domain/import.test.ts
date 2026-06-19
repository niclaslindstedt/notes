import { describe, expect, it } from "vitest";

import {
  IMPORTABLE_EXTENSIONS,
  importedNote,
  isImportableFilename,
  titleFromFilename,
} from "../../src/domain/import.ts";

describe("import domain", () => {
  describe("isImportableFilename", () => {
    it("accepts markdown and text extensions, case-insensitively", () => {
      expect(isImportableFilename("notes.md")).toBe(true);
      expect(isImportableFilename("README.MARKDOWN")).toBe(true);
      expect(isImportableFilename("log.txt")).toBe(true);
    });

    it("rejects non-text files", () => {
      expect(isImportableFilename("photo.png")).toBe(false);
      expect(isImportableFilename("archive.zip")).toBe(false);
      expect(isImportableFilename("noextension")).toBe(false);
    });

    it("covers every advertised extension", () => {
      for (const ext of IMPORTABLE_EXTENSIONS) {
        expect(isImportableFilename(`file${ext}`)).toBe(true);
      }
    });
  });

  describe("titleFromFilename", () => {
    it("strips the extension and keeps the stem", () => {
      expect(titleFromFilename("Meeting Notes.md")).toBe("Meeting Notes");
    });

    it("drops a leading directory path from a folder drop", () => {
      expect(titleFromFilename("inbox/2024/todo.markdown")).toBe("todo");
      expect(titleFromFilename("C:\\Docs\\plan.md")).toBe("plan");
    });

    it("leaves a name without an extension untouched", () => {
      expect(titleFromFilename("just a name")).toBe("just a name");
    });
  });

  describe("importedNote", () => {
    it("uses the filename as the title and the contents as the body", () => {
      const note = importedNote("Shopping.md", "milk\neggs\n", 1234);
      expect(note.title).toBe("Shopping");
      expect(note.body).toBe("milk\neggs");
      expect(note.createdAt).toBe(1234);
      expect(note.updatedAt).toBe(1234);
      expect(note.id).toBeTruthy();
    });

    it("normalises CRLF line endings and trims trailing blank lines", () => {
      const note = importedNote("win.md", "a\r\nb\r\n\r\n");
      expect(note.body).toBe("a\nb");
    });

    it("gives each imported file its own id", () => {
      const a = importedNote("a.md", "x");
      const b = importedNote("b.md", "y");
      expect(a.id).not.toBe(b.id);
    });
  });
});
