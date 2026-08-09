import { describe, expect, it } from "vitest";

import {
  doubleSpacePeriod,
  sentenceBoundaryCount,
} from "../../src/domain/sentence.ts";

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

describe("doubleSpacePeriod", () => {
  it("ends the sentence when a space follows a word and a space", () => {
    // "Hello " with the caret at the end, a second space arriving: the space
    // already there is consumed and ". " written over it.
    expect(doubleSpacePeriod("Hello ", 6)).toEqual({ from: 5, text: ". " });
  });

  it("works mid-line, not only at the end", () => {
    expect(doubleSpacePeriod("Hello there", 6)).toEqual({
      from: 5,
      text: ". ",
    });
  });

  it("leaves a space that does not follow a space alone", () => {
    expect(doubleSpacePeriod("Hello", 5)).toBeNull();
    expect(doubleSpacePeriod("Hello world", 11)).toBeNull();
  });

  it("leaves the typewriter double space after a full stop alone", () => {
    // "Done. " + space: the character in front of the space is punctuation,
    // so the habit of double-spacing between sentences never grows a second
    // dot.
    expect(doubleSpacePeriod("Done. ", 6)).toBeNull();
    expect(doubleSpacePeriod("Really? ", 8)).toBeNull();
    expect(doubleSpacePeriod("Wow! ", 5)).toBeNull();
    expect(doubleSpacePeriod("First, ", 7)).toBeNull();
  });

  it("leaves a run of spaces alone", () => {
    // A third space lands behind a space, not behind a word.
    expect(doubleSpacePeriod("cols  ", 6)).toBeNull();
    expect(doubleSpacePeriod("   ", 3)).toBeNull();
  });

  it("needs a word in front of the space", () => {
    expect(doubleSpacePeriod(" ", 1)).toBeNull();
    expect(doubleSpacePeriod("", 0)).toBeNull();
    expect(doubleSpacePeriod("- ", 2)).toBeNull();
  });

  it("accepts a digit or a closing quote or bracket as the word's tail", () => {
    expect(doubleSpacePeriod("Room 12 ", 8)).toEqual({ from: 7, text: ". " });
    expect(doubleSpacePeriod('He said "go" ', 13)).toEqual({
      from: 12,
      text: ". ",
    });
    expect(doubleSpacePeriod("(aside) ", 8)).toEqual({ from: 7, text: ". " });
  });

  it("accepts a non-ASCII letter as the word's tail", () => {
    expect(doubleSpacePeriod("på gång ", 8)).toEqual({ from: 7, text: ". " });
  });
});
