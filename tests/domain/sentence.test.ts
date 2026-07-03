import { describe, expect, it } from "vitest";

import { sentenceBoundaryCount } from "../../src/domain/sentence.ts";

describe("sentenceBoundaryCount", () => {
  it("is zero for empty or terminator-free text", () => {
    expect(sentenceBoundaryCount("")).toBe(0);
    expect(sentenceBoundaryCount("just a fragment")).toBe(0);
  });

  it("does not count the terminator of the last, still-open sentence", () => {
    // No trailing whitespace after the period, so the sentence being typed
    // stays attached to its own undo step until the caret moves past it.
    expect(sentenceBoundaryCount("Hello world.")).toBe(0);
    expect(sentenceBoundaryCount("Hello world. ")).toBe(1);
  });

  it("counts each completed sentence in a paragraph", () => {
    expect(sentenceBoundaryCount("One. Two! Three? Four.")).toBe(3);
  });

  it("counts a terminator followed by a newline", () => {
    expect(sentenceBoundaryCount("First line.\nSecond line")).toBe(1);
  });

  it("treats an ellipsis or run of terminators as a single boundary", () => {
    expect(sentenceBoundaryCount("Wait... really? yes")).toBe(2);
    expect(sentenceBoundaryCount("Whoa!!! ok")).toBe(1);
  });

  it("allows trailing quotes or brackets before the whitespace", () => {
    expect(sentenceBoundaryCount('He said "go." Then left.')).toBe(1);
    expect(sentenceBoundaryCount("(done.) next")).toBe(1);
  });

  it("ignores a period not followed by whitespace (paths, numbers)", () => {
    expect(sentenceBoundaryCount("see attachments/a.png here")).toBe(0);
    expect(sentenceBoundaryCount("version 3.5 shipped")).toBe(0);
  });
});
