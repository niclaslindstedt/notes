import { describe, expect, it } from "vitest";

import type { Note, Snapshot } from "../../src/domain/note.ts";
import {
  buildSearchIndex,
  parseQuery,
  search,
  segmentMatches,
} from "../../src/domain/search.ts";

function note(partial: Partial<Note> & { id: string }): Note {
  return {
    id: partial.id,
    title: partial.title ?? "",
    body: partial.body,
    preview: partial.preview,
    createdAt: partial.createdAt ?? 0,
    updatedAt: partial.updatedAt ?? 0,
    archived: partial.archived,
  };
}

function snapshot(notes: Note[]): Snapshot {
  return { notes };
}

describe("buildSearchIndex", () => {
  it("emits a title entry and a body entry per loaded note", () => {
    const index = buildSearchIndex(
      snapshot([note({ id: "1", title: "Groceries", body: "milk\neggs" })]),
    );
    expect(index.entries).toEqual([
      {
        noteId: "1",
        noteTitle: "Groceries",
        field: "title",
        text: "Groceries",
      },
      {
        noteId: "1",
        noteTitle: "Groceries",
        field: "body",
        text: "milk\neggs",
      },
    ]);
  });

  it("skips an empty title or empty body", () => {
    const titleOnly = buildSearchIndex(
      snapshot([note({ id: "1", title: "Just a title", body: "" })]),
    );
    expect(titleOnly.entries.map((e) => e.field)).toEqual(["title"]);

    const bodyOnly = buildSearchIndex(
      snapshot([note({ id: "2", title: "", body: "just a body" })]),
    );
    expect(bodyOnly.entries.map((e) => e.field)).toEqual(["body"]);
  });

  it("omits archived notes", () => {
    const index = buildSearchIndex(
      snapshot([
        note({ id: "1", title: "kept", body: "x" }),
        note({ id: "2", title: "gone", body: "y", archived: true }),
      ]),
    );
    expect(index.entries.every((e) => e.noteId === "1")).toBe(true);
  });

  it("searches a deferred note through its preview (lazy encryption fit)", () => {
    // A deferred note has no `body` — only the index-supplied `preview`. The
    // engine must still find body text through `notePreviewBlock`'s fallback.
    const index = buildSearchIndex(
      snapshot([
        note({ id: "1", title: "Secret", preview: "the launch codes" }),
      ]),
    );
    const body = index.entries.find((e) => e.field === "body");
    expect(body?.text).toBe("the launch codes");
    expect(search(index, "launch").results).toHaveLength(1);
  });

  it("strips attachment markdown from the searched body", () => {
    const index = buildSearchIndex(
      snapshot([
        note({
          id: "1",
          title: "Pic",
          body: "see ![alt](attachments/x.png) here",
        }),
      ]),
    );
    const body = index.entries.find((e) => e.field === "body")!;
    expect(body.text).not.toContain("attachments/");
    expect(body.text).toContain("see");
    expect(body.text).toContain("here");
  });
});

describe("parseQuery", () => {
  it("classifies empty, text, wildcard, and regex queries", () => {
    expect(parseQuery("   ").kind).toBe("empty");
    expect(parseQuery("hello")).toMatchObject({
      kind: "matcher",
      matcher: { kind: "text" },
    });
    expect(parseQuery("ca*")).toMatchObject({
      kind: "matcher",
      matcher: { kind: "wildcard" },
    });
    expect(parseQuery("/ab.+/i")).toMatchObject({
      kind: "matcher",
      matcher: { kind: "regex" },
    });
  });

  it("reports an invalid regex rather than throwing", () => {
    expect(parseQuery("/(/").kind).toBe("invalid");
  });
});

describe("search", () => {
  const index = buildSearchIndex(
    snapshot([
      note({ id: "a", title: "Grocery list", body: "milk, eggs, bread" }),
      note({ id: "b", title: "Vacation plan", body: "book flights to Rome" }),
      note({ id: "c", title: "Sunscreen reminder", body: "buy SPF 50" }),
    ]),
  );

  it("returns no results for an empty query", () => {
    expect(search(index, "").results).toEqual([]);
  });

  it("flags an invalid regex", () => {
    const out = search(index, "/(/");
    expect(out.invalidRegex).toBe(true);
    expect(out.results).toEqual([]);
  });

  it("matches a substring in the body and carries ranges", () => {
    const out = search(index, "eggs");
    expect(out.results).toHaveLength(1);
    expect(out.results[0]!.noteId).toBe("a");
    expect(out.results[0]!.body).not.toBeNull();
    const [start, end] = out.results[0]!.body!.ranges[0]!;
    expect(out.results[0]!.body!.text.slice(start, end)).toBe("eggs");
  });

  it("matches a title and fills titleRanges", () => {
    const out = search(index, "Vacation");
    expect(out.results[0]!.noteId).toBe("b");
    expect(out.results[0]!.titleRanges).not.toBeNull();
  });

  it("falls back to a fuzzy subsequence when the substring misses", () => {
    const out = search(index, "grcl");
    expect(out.results.some((r) => r.noteId === "a")).toBe(true);
  });

  it("supports shell wildcards", () => {
    const out = search(index, "sun?creen");
    expect(out.results.some((r) => r.noteId === "c")).toBe(true);
  });

  it("supports /regex/ queries", () => {
    const out = search(index, "/SPF \\d+/");
    expect(out.results.some((r) => r.noteId === "c")).toBe(true);
  });

  it("ranks a title hit above a body-only hit", () => {
    const local = buildSearchIndex(
      snapshot([
        note({ id: "body", title: "Nothing", body: "a rome trip note" }),
        note({ id: "title", title: "Rome", body: "nothing relevant" }),
      ]),
    );
    const out = search(local, "rome");
    expect(out.results[0]!.noteId).toBe("title");
  });
});

describe("segmentMatches", () => {
  it("splits text into plain and matched runs", () => {
    expect(segmentMatches("abcdef", [[2, 4]])).toEqual([
      { text: "ab", match: false },
      { text: "cd", match: true },
      { text: "ef", match: false },
    ]);
  });

  it("returns the whole text as one plain run when nothing matched", () => {
    expect(segmentMatches("abc", [])).toEqual([{ text: "abc", match: false }]);
  });
});
