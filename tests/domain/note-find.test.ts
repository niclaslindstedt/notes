import { describe, expect, it } from "vitest";

import {
  findHits,
  findMatches,
  isPatternValid,
  matchLineSpans,
} from "../../src/domain/note-find.ts";

describe("findMatches", () => {
  it("finds nothing for an empty query", () => {
    expect(findMatches("hello world", "")).toEqual([]);
  });

  it("reports each hit in source coordinates", () => {
    expect(findMatches("hello world", "world")).toEqual([
      { line: 0, from: 6, endLine: 0, to: 11 },
    ]);
  });

  it("matches case-insensitively", () => {
    expect(findMatches("Hello HELLO hello", "hello")).toEqual([
      { line: 0, from: 0, endLine: 0, to: 5 },
      { line: 0, from: 6, endLine: 0, to: 11 },
      { line: 0, from: 12, endLine: 0, to: 17 },
    ]);
  });

  it("walks the lines in document order", () => {
    const body = "one two\nthree\ntwo more";
    expect(findMatches(body, "two")).toEqual([
      { line: 0, from: 4, endLine: 0, to: 7 },
      { line: 2, from: 0, endLine: 2, to: 3 },
    ]);
  });

  it("takes the query verbatim rather than as a pattern", () => {
    expect(findMatches("a.b axb", "a.b")).toEqual([
      { line: 0, from: 0, endLine: 0, to: 3 },
    ]);
    expect(findMatches("cost is $5 (net)", "$5 (net)")).toEqual([
      { line: 0, from: 8, endLine: 0, to: 16 },
    ]);
  });

  it("keeps hits non-overlapping", () => {
    expect(findMatches("aaaa", "aa")).toEqual([
      { line: 0, from: 0, endLine: 0, to: 2 },
      { line: 0, from: 2, endLine: 0, to: 4 },
    ]);
  });

  it("keeps columns aligned when a character lowercases to two units", () => {
    // "İ".toLowerCase() is two code units, so lowercasing both sides would
    // slide every later column out of step with the source.
    const body = "İstanbul note";
    expect(findMatches(body, "note")).toEqual([
      { line: 0, from: 9, endLine: 0, to: 13 },
    ]);
  });

  it("matches leading and trailing spaces verbatim", () => {
    expect(findMatches("a  b", " ")).toEqual([
      { line: 0, from: 1, endLine: 0, to: 2 },
      { line: 0, from: 2, endLine: 0, to: 3 },
    ]);
  });

  it("never matches across a line break", () => {
    expect(findMatches("one\ntwo", "one two")).toEqual([]);
  });

  it("takes a typed backslash-n verbatim, not as a line break", () => {
    expect(findMatches("one\ntwo", "\\n")).toEqual([]);
    expect(findMatches("a \\n b", "\\n")).toEqual([
      { line: 0, from: 2, endLine: 0, to: 4 },
    ]);
  });
});

// The find bar's `(.*)` toggle. The scan is unchanged in every other respect —
// still case-insensitive, `^` and `$` still a line's edges — so only the
// reading of the query moves.
describe("findMatches: regex mode", () => {
  const regex = { regex: true };

  it("reads the query as a pattern rather than as characters", () => {
    expect(findMatches("a.b axb", "a.b", regex)).toEqual([
      { line: 0, from: 0, endLine: 0, to: 3 },
      { line: 0, from: 4, endLine: 0, to: 7 },
    ]);
  });

  it("anchors ^ and $ to each line, not to the whole note", () => {
    const body = "alpha\nbeta\nalpha again";
    expect(findMatches(body, "^alpha$", regex)).toEqual([
      { line: 0, from: 0, endLine: 0, to: 5 },
    ]);
    expect(findMatches(body, "^alpha", regex)).toEqual([
      { line: 0, from: 0, endLine: 0, to: 5 },
      { line: 2, from: 0, endLine: 2, to: 5 },
    ]);
  });

  it("still ignores case", () => {
    expect(findMatches("Alpha", "alp.a", regex)).toEqual([
      { line: 0, from: 0, endLine: 0, to: 5 },
    ]);
  });

  it("finds nothing for a pattern that doesn't compile", () => {
    expect(findMatches("(foo)", "(foo", regex)).toEqual([]);
  });

  // `x*` matches the empty string at every column; there is no span to
  // highlight, step onto, or replace, so those are skipped rather than
  // flooding the bar with hits that point at nothing.
  it("drops zero-length matches instead of spinning on them", () => {
    expect(findMatches("axxb", "x*", regex)).toEqual([
      { line: 0, from: 1, endLine: 0, to: 3 },
    ]);
    expect(findMatches("abc", "q*", regex)).toEqual([]);
  });

  it("keeps a `.` from swallowing the line break", () => {
    expect(findMatches("one\ntwo", "one.two", regex)).toEqual([]);
  });
});

// `\n` matches a real line break, the way a code editor's find widget reads it,
// so a hit can start on one line and end on another.
describe("findMatches: across a line break", () => {
  const regex = { regex: true };

  it("matches a bare line break", () => {
    expect(findMatches("one\ntwo", "\\n", regex)).toEqual([
      { line: 0, from: 3, endLine: 1, to: 0 },
    ]);
  });

  it("reports a hit that spans lines with its own end line", () => {
    expect(findMatches("one\ntwo\nthree", "e\\nt", regex)).toEqual([
      { line: 0, from: 2, endLine: 1, to: 1 },
    ]);
  });

  it("finds the blank line between two paragraphs", () => {
    expect(findMatches("a\n\nb\n\nc", "\\n\\n", regex)).toEqual([
      { line: 0, from: 1, endLine: 2, to: 0 },
      { line: 2, from: 1, endLine: 4, to: 0 },
    ]);
  });

  it("still keeps hits non-overlapping across breaks", () => {
    expect(findMatches("a\na\na", "a\\n", regex)).toEqual([
      { line: 0, from: 0, endLine: 1, to: 0 },
      { line: 1, from: 0, endLine: 2, to: 0 },
    ]);
  });
});

describe("matchLineSpans", () => {
  it("hands a single-line hit back as one span", () => {
    const [match] = findMatches("hello world", "world");
    expect(matchLineSpans(match!, ["hello world"])).toEqual([
      { line: 0, from: 6, to: 11 },
    ]);
  });

  it("cuts a spanning hit into one span per line", () => {
    const lines = ["one", "two", "three"];
    const [match] = findMatches(lines.join("\n"), "e\\ntwo\\nt", {
      regex: true,
    });
    expect(matchLineSpans(match!, lines)).toEqual([
      { line: 0, from: 2, to: 3 },
      { line: 1, from: 0, to: 3 },
      { line: 2, from: 0, to: 1 },
    ]);
  });

  it("drops the empty spans a line break leaves at either edge", () => {
    // The break itself lives past the end of line 0's text and before the
    // start of line 1's, so a bare `\n` has no ink to paint on either.
    const [match] = findMatches("one\ntwo", "\\n", { regex: true });
    expect(matchLineSpans(match!, ["one", "two"])).toEqual([]);
  });
});

describe("isPatternValid", () => {
  it("accepts an empty query — it simply finds nothing", () => {
    expect(isPatternValid("", { regex: true })).toBe(true);
  });

  it("accepts anything at all in literal mode", () => {
    expect(isPatternValid("(foo", {})).toBe(true);
    expect(isPatternValid("*[", {})).toBe(true);
  });

  it("rejects a pattern that doesn't compile in regex mode", () => {
    expect(isPatternValid("(foo", { regex: true })).toBe(false);
    expect(isPatternValid("(foo)", { regex: true })).toBe(true);
  });
});

describe("findHits", () => {
  it("carries the raw match, so a replacement can read its captures", () => {
    const hits = findHits("2024-05-01", "(\\d{4})-(\\d{2})", { regex: true });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ line: 0, from: 0, endLine: 0, to: 7 });
    expect([...hits[0]!.match]).toEqual(["2024-05", "2024", "05"]);
  });

  it("carries named groups through too", () => {
    const hits = findHits("2024-05", "(?<year>\\d{4})", { regex: true });
    expect(hits[0]?.match.groups?.year).toBe("2024");
  });

  it("captures nothing in literal mode", () => {
    const hits = findHits("a(b)", "(b)");
    expect(hits[0]).toMatchObject({ line: 0, from: 1, endLine: 0, to: 4 });
    expect([...hits[0]!.match]).toEqual(["(b)"]);
  });
});
