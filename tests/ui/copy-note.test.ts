import { describe, expect, it } from "vitest";

import type { Note } from "../../src/domain/note.ts";
import { noteToMarkdown } from "../../src/storage/markdown/codec.ts";
import { buildCopyText } from "../../src/ui/copy-note.ts";

function note(title: string, body: string): Note {
  return { id: "abc123", title, body, createdAt: 100, updatedAt: 200 };
}

describe("buildCopyText", () => {
  it("body copies just the body, never the title", () => {
    expect(buildCopyText(note("Groceries", "milk\neggs"), "body")).toBe(
      "milk\neggs",
    );
  });

  it("titleBody prepends the title as a Markdown heading", () => {
    expect(buildCopyText(note("Groceries", "milk\neggs"), "titleBody")).toBe(
      "# Groceries\n\nmilk\neggs",
    );
  });

  it("titleBody falls back to the body when there is no title", () => {
    expect(buildCopyText(note("  ", "milk"), "titleBody")).toBe("milk");
  });

  it("titleBody drops the blank line when the body is empty", () => {
    expect(buildCopyText(note("Groceries", ""), "titleBody")).toBe(
      "# Groceries",
    );
  });

  it("frontMatter copies the whole .md file the codec writes", () => {
    const n = note("Groceries", "milk\neggs");
    expect(buildCopyText(n, "frontMatter")).toBe(noteToMarkdown(n));
  });
});
