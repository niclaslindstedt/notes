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

  it("ignores the editor's trailing newline on the sentence being typed", () => {
    // The live-preview editor keeps a trailing empty line, so the body arrives
    // as `"This?\n"` mid-typing. That trailing newline must not turn the still-
    // open last sentence into a completed one — otherwise its undo step splits
    // and undo peels only the terminator off (`This?` → `This`).
    expect(sentenceBoundaryCount("This?\n")).toBe(0);
    expect(sentenceBoundaryCount("This?\n\n")).toBe(0);
    // A completed earlier sentence still counts; only the trailing, in-progress
    // one is spared — so a paragraph ending mid-sentence keeps its checkpoints.
    expect(sentenceBoundaryCount("One. Two.\n")).toBe(1);
    expect(sentenceBoundaryCount("One. Two. Three.\n")).toBe(2);
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
