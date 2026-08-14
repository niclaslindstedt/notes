import { describe, expect, it } from "vitest";

import {
  previewReplacements,
  replaceAll,
  replaceOne,
} from "../../src/domain/note-replace.ts";

const REGEX = { regex: true };

describe("replaceAll", () => {
  it("rewrites every hit, case-insensitively", () => {
    expect(replaceAll("Alpha beta ALPHA", "alpha", "x")).toBe("x beta x");
  });

  it("rewrites across lines, leaving untouched lines alone", () => {
    const body = "one two\nthree\ntwo more";
    expect(replaceAll(body, "two", "2")).toBe("one 2\nthree\n2 more");
  });

  it("leaves the body identical when nothing matches", () => {
    const body = "nothing to see";
    expect(replaceAll(body, "absent", "x")).toBe(body);
  });

  it("finds nothing for an empty query", () => {
    expect(replaceAll("abc", "", "x")).toBe("abc");
  });

  // The line is rebuilt from the *original*, so a replacement containing the
  // query is never itself matched — the pass terminates rather than feeding on
  // its own output.
  it("never re-scans what it just wrote", () => {
    expect(replaceAll("a a", "a", "aa")).toBe("aa aa");
    expect(replaceAll("xx", "x", "xx")).toBe("xxxx");
  });

  it("keeps later columns in step as earlier hits change length", () => {
    expect(replaceAll("a-a-a", "a", "LONG")).toBe("LONG-LONG-LONG");
  });

  it("deletes the matches when the replacement is empty", () => {
    expect(replaceAll("a1b2c3", "\\d", "", REGEX)).toBe("abc");
  });

  it("inserts a literal replacement verbatim, `$` and all", () => {
    expect(replaceAll("cost", "cost", "$1")).toBe("$1");
  });

  it("expands `$1` and `$&` against a pattern's captures", () => {
    expect(replaceAll("2024-05-01", "(\\d{4})-(\\d{2})", "$2/$1", REGEX)).toBe(
      "05/2024-01",
    );
    expect(replaceAll("cat", "c(a)t", "[$&:$1]", REGEX)).toBe("[cat:a]");
  });

  it("writes a literal `$` for `$$`, and leaves an unknown group standing", () => {
    expect(replaceAll("x", "(x)", "$$$1", REGEX)).toBe("$x");
    expect(replaceAll("x", "(x)", "$7", REGEX)).toBe("$7");
  });

  // The `$`-template grammar is Transform's `expandReplacement`, shared rather
  // than reimplemented — so named groups work here for free.
  it("expands a named group", () => {
    expect(
      replaceAll(
        "2024-05",
        "(?<year>\\d{4})-(?<month>\\d{2})",
        "$<month>.$<year>",
        REGEX,
      ),
    ).toBe("05.2024");
  });

  // The same reading `String.replace` gives it: group 1 followed by a literal
  // `2`, since the pattern has no twelfth group.
  it("falls back to the single-digit group for `$12` when there is no group 12", () => {
    expect(replaceAll("x", "(x)", "$12", REGEX)).toBe("x2");
  });
});

describe("replaceOne", () => {
  it("rewrites only the hit at the given index", () => {
    const result = replaceOne("a a a", "a", "X", 1);
    expect(result?.body).toBe("a X a");
  });

  it("parks on the hit that follows the text it just inserted", () => {
    // "one two\nthree\ntwo more" — replacing the first "two" leaves the second
    // as hit 0 of the rewritten body.
    const result = replaceOne("one two\nthree\ntwo more", "two", "2", 0);
    expect(result).toEqual({ body: "one 2\nthree\ntwo more", index: 0 });
  });

  it("wraps to the first hit when it replaced the last one", () => {
    const result = replaceOne("a a", "a", "X", 1);
    expect(result).toEqual({ body: "a X", index: 0 });
  });

  it("reports -1 when the rewrite left no hits at all", () => {
    expect(replaceOne("a", "a", "X", 0)).toEqual({ body: "X", index: -1 });
  });

  // Standing still here would re-replace the text just written, so `a` → `aa`
  // would grow forever under a held Enter.
  it("steps past a replacement that matches the query again", () => {
    const first = replaceOne("a a", "a", "aa", 0);
    expect(first).toEqual({ body: "aa a", index: 2 });
    // Hit 2 is the untouched second "a", not either half of what was written.
    const second = replaceOne(first!.body, "a", "aa", first!.index);
    expect(second?.body).toBe("aa aa");
  });

  it("returns null for an index with no hit behind it", () => {
    expect(replaceOne("a", "a", "X", 5)).toBeNull();
    expect(replaceOne("a", "absent", "X", 0)).toBeNull();
  });

  it("expands captures the same way replace-all does", () => {
    const result = replaceOne("mr smith", "mr (\\w+)", "Mr. $1", 0, REGEX);
    expect(result?.body).toBe("Mr. smith");
  });
});

describe("previewReplacements", () => {
  it("describes an affected line as kept / removed / added runs", () => {
    expect(previewReplacements("one two three", "two", "2")).toEqual([
      {
        line: 0,
        segments: [
          { kind: "kept", text: "one " },
          { kind: "removed", text: "two" },
          { kind: "added", text: "2" },
          { kind: "kept", text: " three" },
        ],
      },
    ]);
  });

  it("leaves untouched lines out entirely", () => {
    const preview = previewReplacements("hit\nmiss\nhit", "hit", "x");
    expect(preview.map((p) => p.line)).toEqual([0, 2]);
  });

  it("folds several hits on one line into a single entry", () => {
    const preview = previewReplacements("a a", "a", "b");
    expect(preview).toHaveLength(1);
    expect(preview[0]?.segments).toEqual([
      { kind: "removed", text: "a" },
      { kind: "added", text: "b" },
      { kind: "kept", text: " " },
      { kind: "removed", text: "a" },
      { kind: "added", text: "b" },
    ]);
  });

  it("emits no `added` run when the replacement is empty", () => {
    expect(previewReplacements("ab", "a", "")[0]?.segments).toEqual([
      { kind: "removed", text: "a" },
      { kind: "kept", text: "b" },
    ]);
  });

  it("shows nothing when nothing matches", () => {
    expect(previewReplacements("abc", "z", "x")).toEqual([]);
    expect(previewReplacements("abc", "", "x")).toEqual([]);
  });

  // The preview and the buttons must agree, or the panel is a lie — same scan,
  // same expansion, so applying what was previewed produces exactly it.
  it("agrees with what replaceAll would write", () => {
    const body = "2024-05-01 and 2023-12-31";
    const query = "(\\d{4})-(\\d{2})";
    const preview = previewReplacements(body, query, "$2/$1", REGEX);
    const rebuilt = preview[0]?.segments
      .filter((s) => s.kind !== "removed")
      .map((s) => s.text)
      .join("");
    expect(rebuilt).toBe(replaceAll(body, query, "$2/$1", REGEX));
  });
});
