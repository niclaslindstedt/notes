// @vitest-environment jsdom
//
// The marks that make a cut a deferred delete: written when an image is cut,
// dropped when the paste lands, and lapsed when nothing ever claims them.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearCut,
  clearCuts,
  markCut,
  pendingCuts,
} from "../../src/app/attachment-cuts.ts";

describe("attachment cut marks", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("remembers a cut and hands it back", () => {
    markCut("n1", "pic.png");
    expect(pendingCuts().map((c) => [c.noteId, c.filename])).toEqual([
      ["n1", "pic.png"],
    ]);
  });

  it("records each attachment once per note", () => {
    markCut("n1", "pic.png");
    markCut("n1", "pic.png");
    markCut("n1", "other.png");
    expect(pendingCuts()).toHaveLength(2);
  });

  it("forgets one cut, or every cut of a note", () => {
    markCut("n1", "a.png");
    markCut("n1", "b.png");
    markCut("n2", "c.png");
    clearCut("n1", "a.png");
    expect(
      pendingCuts()
        .map((c) => c.filename)
        .sort(),
    ).toEqual(["b.png", "c.png"]);
    clearCut("n1");
    expect(pendingCuts().map((c) => c.filename)).toEqual(["c.png"]);
  });

  it("clears a batch and leaves the rest", () => {
    markCut("n1", "a.png");
    markCut("n2", "b.png");
    clearCuts([{ noteId: "n1", filename: "a.png", at: Date.now() }]);
    expect(pendingCuts().map((c) => c.filename)).toEqual(["b.png"]);
  });

  it("lapses a mark nothing claimed for a week", () => {
    const eightDays = 8 * 24 * 60 * 60 * 1000;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    markCut("n1", "pic.png");
    vi.setSystemTime(new Date(eightDays));
    expect(pendingCuts()).toEqual([]);
  });

  it("survives junk in the key rather than throwing", () => {
    localStorage.setItem("notes:cut-attachments", "{not json");
    expect(pendingCuts()).toEqual([]);
    localStorage.setItem("notes:cut-attachments", '[{"noteId":1}]');
    expect(pendingCuts()).toEqual([]);
  });
});
