import { describe, expect, it } from "vitest";

import { findMatches } from "../../src/domain/note-find.ts";

describe("findMatches", () => {
  it("finds nothing for an empty query", () => {
    expect(findMatches("hello world", "")).toEqual([]);
  });

  it("reports each hit in source coordinates", () => {
    expect(findMatches("hello world", "world")).toEqual([
      { line: 0, from: 6, to: 11 },
    ]);
  });

  it("matches case-insensitively", () => {
    expect(findMatches("Hello HELLO hello", "hello")).toEqual([
      { line: 0, from: 0, to: 5 },
      { line: 0, from: 6, to: 11 },
      { line: 0, from: 12, to: 17 },
    ]);
  });

  it("walks the lines in document order", () => {
    const body = "one two\nthree\ntwo more";
    expect(findMatches(body, "two")).toEqual([
      { line: 0, from: 4, to: 7 },
      { line: 2, from: 0, to: 3 },
    ]);
  });

  it("takes the query verbatim rather than as a pattern", () => {
    expect(findMatches("a.b axb", "a.b")).toEqual([
      { line: 0, from: 0, to: 3 },
    ]);
    expect(findMatches("cost is $5 (net)", "$5 (net)")).toEqual([
      { line: 0, from: 8, to: 16 },
    ]);
  });

  it("keeps hits non-overlapping", () => {
    expect(findMatches("aaaa", "aa")).toEqual([
      { line: 0, from: 0, to: 2 },
      { line: 0, from: 2, to: 4 },
    ]);
  });

  it("keeps columns aligned when a character lowercases to two units", () => {
    // "İ".toLowerCase() is two code units, so lowercasing both sides would
    // slide every later column out of step with the source.
    const body = "İstanbul note";
    expect(findMatches(body, "note")).toEqual([{ line: 0, from: 9, to: 13 }]);
  });

  it("matches leading and trailing spaces verbatim", () => {
    expect(findMatches("a  b", " ")).toEqual([
      { line: 0, from: 1, to: 2 },
      { line: 0, from: 2, to: 3 },
    ]);
  });

  it("never matches across a line break", () => {
    expect(findMatches("one\ntwo", "one two")).toEqual([]);
  });
});
