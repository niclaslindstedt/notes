import { describe, expect, it } from "vitest";

import { classifyLines } from "../../src/domain/markdown.ts";
import {
  applyFormat,
  isUrlText,
  lineFormatAt,
  newlineFor,
  type FormatAction,
} from "../../src/domain/markdown-format.ts";

// Apply an action to a source string with the selection written inline: `|`
// marks a caret, and a `[`…`]` pair marks a ranged selection. Returns the new
// source with the resulting selection marked back up the same way, so a test
// reads as one before/after string pair.
function run(marked: string, action: FormatAction): string {
  const { text, start, end } = unmark(marked);
  const result = applyFormat(text.split("\n"), { start, end }, action);
  return mark(result.lines, result.start, result.end);
}

function unmark(marked: string) {
  const caret = marked.indexOf("|");
  if (caret !== -1) {
    const text = marked.replace("|", "");
    const point = pointAt(text, caret);
    return { text, start: point, end: point };
  }
  // The selection brackets are the outermost pair, so the closer is the *last*
  // `]` — a task row's `[ ]` box puts literal brackets inside the span, and
  // taking the first one would end the selection in the middle of the marker.
  const open = marked.indexOf("[");
  const close = marked.lastIndexOf("]") - 1;
  const text = marked.replace("[", "").replace(/]([^\]]*)$/, "$1");
  return { text, start: pointAt(text, open), end: pointAt(text, close) };
}

function pointAt(text: string, offset: number) {
  const before = text.slice(0, offset);
  const line = before.split("\n").length - 1;
  return { line, col: offset - (before.lastIndexOf("\n") + 1) };
}

function mark(
  lines: string[],
  start: { line: number; col: number },
  end: { line: number; col: number },
) {
  const out = [...lines];
  const insert = (p: { line: number; col: number }, ch: string) => {
    const l = out[p.line] ?? "";
    out[p.line] = l.slice(0, p.col) + ch + l.slice(p.col);
  };
  if (start.line === end.line && start.col === end.col) {
    insert(start, "|");
  } else {
    insert(end, "]");
    insert(start, "[");
  }
  return out.join("\n");
}

const BOLD: FormatAction = { kind: "inline", delimiter: "**" };
const ITALIC: FormatAction = { kind: "inline", delimiter: "*" };
const CODE: FormatAction = { kind: "inline", delimiter: "`" };

describe("headings", () => {
  it("marks the caret's line at the asked-for level", () => {
    expect(run("hello| world", { kind: "heading", level: 2 })).toBe(
      "## hello| world",
    );
  });

  it("toggles a heading of the same level back to a paragraph", () => {
    expect(run("## hello| world", { kind: "heading", level: 2 })).toBe(
      "hello| world",
    );
  });

  it("changes level rather than stacking hashes", () => {
    expect(run("### a|", { kind: "heading", level: 1 })).toBe("# a|");
  });

  it("replaces a list marker instead of nesting under it", () => {
    expect(run("- item|", { kind: "heading", level: 1 })).toBe("# item|");
  });

  it("re-marks every line a selection touches", () => {
    expect(run("[one\ntwo]", { kind: "heading", level: 1 })).toBe(
      "[# one\n# two]",
    );
  });
});

describe("lists", () => {
  it("bullets the caret's line", () => {
    expect(run("milk|", { kind: "list", ordered: false })).toBe("- milk|");
  });

  it("un-bullets a line that is already a bullet", () => {
    expect(run("- milk|", { kind: "list", ordered: false })).toBe("milk|");
  });

  it("numbers an ordered list sequentially", () => {
    expect(run("[a\nb\nc]", { kind: "list", ordered: true })).toBe(
      "[1. a\n2. b\n3. c]",
    );
  });

  it("converts a bullet list to an ordered one", () => {
    const out = run("[- a\n- b]", { kind: "list", ordered: true });
    expect(out).toBe("[1. a\n2. b]");
  });

  it("keeps the indent of a nested item", () => {
    expect(run("  child|", { kind: "list", ordered: false })).toBe(
      "  - child|",
    );
  });

  it("marks a mixed selection as a whole rather than flipping each line", () => {
    expect(run("[- a\nb]", { kind: "list", ordered: false })).toBe(
      "[- a\n- b]",
    );
  });
});

describe("checklists", () => {
  const TASK: FormatAction = { kind: "task" };
  const BULLET: FormatAction = { kind: "list", ordered: false };

  it("opens the caret's line as an unticked task row", () => {
    expect(run("milk|", TASK)).toBe("- [ ] milk|");
  });

  it("toggles a task row back to plain text", () => {
    expect(run("- [ ] milk|", TASK)).toBe("milk|");
    // A ticked row un-lists the same way — the box goes with the marker.
    expect(run("- [x] milk|", TASK)).toBe("milk|");
  });

  it("swaps a bullet's marker for a box rather than stacking one on it", () => {
    expect(run("- milk|", TASK)).toBe("- [ ] milk|");
    expect(run("1. milk|", TASK)).toBe("- [ ] milk|");
    expect(run("## milk|", TASK)).toBe("- [ ] milk|");
  });

  it("converts a task row to a plain bullet, keeping it a list", () => {
    // The row is a `ul` either way, so Bullet must *change* it rather than
    // read it as already-bulleted and un-list it outright.
    expect(run("- [ ] milk|", BULLET)).toBe("- milk|");
    expect(run("- [x] milk|", BULLET)).toBe("- milk|");
    // And pressing Bullet again from there does un-list it.
    expect(run("- milk|", BULLET)).toBe("milk|");
  });

  it("keeps a nested row's indent", () => {
    expect(run("  child|", TASK)).toBe("  - [ ] child|");
    expect(run("  - [x] child|", TASK)).toBe("  child|");
  });

  it("opens an empty row to type into on a blank line", () => {
    expect(run("|", TASK)).toBe("- [ ] |");
  });

  it("marks every line a selection touches, unticked", () => {
    expect(run("[a\nb]", TASK)).toBe("[- [ ] a\n- [ ] b]");
  });

  it("marks a mixed selection as a whole rather than flipping each line", () => {
    expect(run("[- [ ] a\nb]", TASK)).toBe("[- [ ] a\n- [ ] b]");
  });
});

describe("quotes", () => {
  it("toggles a quote marker on and off", () => {
    expect(run("said|", { kind: "quote" })).toBe("> said|");
    expect(run("> said|", { kind: "quote" })).toBe("said|");
  });
});

describe("indentation", () => {
  it("indents a bullet into a child", () => {
    expect(run("- child|", { kind: "indent" })).toBe("  - child|");
  });

  it("outdents by one step", () => {
    expect(run("  - child|", { kind: "indent", outdent: true })).toBe(
      "- child|",
    );
  });

  it("outdents a tab as one step", () => {
    expect(run("\t- child|", { kind: "indent", outdent: true })).toBe(
      "- child|",
    );
  });

  it("leaves a blank separator inside a selection alone", () => {
    expect(run("[- a\n\n- b]", { kind: "indent" })).toBe("[  - a\n\n  - b]");
  });

  it("indents the caret's own blank line, ready to type a child into", () => {
    expect(run("- a\n|", { kind: "indent" })).toBe("- a\n  |");
  });

  it("outdents an indented blank line back to the margin", () => {
    expect(run("- a\n  |", { kind: "indent", outdent: true })).toBe("- a\n|");
  });

  it("is a no-op at the left margin", () => {
    expect(run("a|", { kind: "indent", outdent: true })).toBe("a|");
  });
});

describe("inline emphasis", () => {
  it("wraps a ranged selection and keeps the whole run selected", () => {
    expect(run("say [hello] there", BOLD)).toBe("say [**hello**] there");
  });

  it("unwraps when the selection sits inside the delimiters", () => {
    expect(run("say **[hello]** there", BOLD)).toBe("say [hello] there");
  });

  it("unwraps when the delimiters are inside the selection", () => {
    expect(run("say [**hello**] there", BOLD)).toBe("say [hello] there");
  });

  it("takes the word under a bare caret", () => {
    expect(run("say hel|lo there", ITALIC)).toBe("say *[hello]* there");
  });

  it("opens an empty pair when there is no word to take", () => {
    expect(run("say |", CODE)).toBe("say `|`");
  });

  it("trims the delimiters onto the text of a sloppy selection", () => {
    expect(run("say [hello ]there", BOLD)).toBe("say [**hello**] there");
  });

  it("wraps each line of a multi-line selection separately", () => {
    expect(run("[one\ntwo]", BOLD)).toBe("[**one**\n**two**]");
  });

  it("skips blank lines inside a multi-line selection", () => {
    expect(run("[one\n\ntwo]", BOLD)).toBe("[**one**\n\n**two**]");
  });

  it("takes the whole run off from a caret anywhere inside it", () => {
    expect(run("say **hel|lo there** now", BOLD)).toBe("say [hello there] now");
  });

  it("takes the whole run off from a partial selection of it", () => {
    expect(run("say **[hello] there** now", BOLD)).toBe(
      "say [hello there] now",
    );
  });

  it("takes only one mark off a run wearing two", () => {
    expect(run("***x|***", BOLD)).toBe("[*x*]");
    expect(run("***x|***", ITALIC)).toBe("[**x**]");
  });

  it("unwraps the innermost run of the delimiter pressed", () => {
    expect(run("**a *b|* c**", ITALIC)).toBe("**a [b] c**");
  });

  it("unwraps a run written with underscores", () => {
    expect(run("say _hel|lo_ now", ITALIC)).toBe("say [hello] now");
  });

  it("falls back to the characters either side inside a fenced block", () => {
    // A fenced line renders verbatim, so the parser reports no run there for
    // the toolbar to light — a press still toggles the delimiters it finds.
    expect(run("```\n**a|**\n```", BOLD)).toBe("```\n[a]\n```");
  });
});

describe("the caret's inline marks", () => {
  // The toolbar's lit buttons, as reported for a caret written in the source.
  function marksAt(marked: string): string[] {
    const { text, start, end } = unmark(marked);
    return (
      lineFormatAt(text.split("\n"), start.line, {
        from: start.col,
        to: end.col,
      })?.inline ?? []
    );
  }

  it("reports the run a bare caret sits in", () => {
    expect(marksAt("say **hel|lo** now")).toEqual(["**"]);
    expect(marksAt("say ~~hel|lo~~ now")).toEqual(["~~"]);
    expect(marksAt("say `hel|lo` now")).toEqual(["`"]);
  });

  it("reports nothing outside a run", () => {
    expect(marksAt("say **hello** n|ow")).toEqual([]);
  });

  it("reports every mark the caret is inside, outermost first", () => {
    expect(marksAt("**a *b|c* d**")).toEqual(["**", "*"]);
  });

  it("reads a run wearing both marks as both", () => {
    expect(marksAt("***x|***")).toEqual(["**", "*"]);
  });

  it("does not mistake bold for italic", () => {
    expect(marksAt("**b|old**")).toEqual(["**"]);
  });

  it("reports the run a selection sits within", () => {
    expect(marksAt("say **[hello]** now")).toEqual(["**"]);
  });

  it("reports nothing for a line inside a fence", () => {
    expect(marksAt("```\n**a|**\n```")).toEqual([]);
  });

  it("reads past a block marker, not through it", () => {
    expect(marksAt("- **mi|lk**")).toEqual(["**"]);
    // The `-` bullet marker is not an emphasis delimiter.
    expect(marksAt("- mi|lk")).toEqual([]);
  });
});

describe("code fences", () => {
  it("fences the selected lines", () => {
    expect(run("[a\nb]", { kind: "fence" })).toBe("```\n[a\nb]\n```");
  });

  it("unfences a block the selection sits inside", () => {
    expect(run("```\n[a\nb]\n```", { kind: "fence" })).toBe("[a\nb]");
  });

  it("opens an empty block around a bare caret", () => {
    expect(run("|", { kind: "fence" })).toBe("```\n|\n```");
  });
});

describe("horizontal rule", () => {
  it("drops a rule below the caret's line and lands beneath it", () => {
    expect(run("before|", { kind: "rule" })).toBe("before\n---\n|");
  });

  it("writes into a blank caret line rather than leaving a gap", () => {
    expect(run("before\n|", { kind: "rule" })).toBe("before\n---\n|");
  });
});

describe("links and images", () => {
  it("makes the selection the label and selects the url placeholder", () => {
    expect(run("see [docs] now", { kind: "link" })).toBe(
      "see [docs]([url]) now",
    );
  });

  it("makes a selected url the href and lands in the empty label", () => {
    expect(run("[https://a.example] x", { kind: "link" })).toBe(
      "[|](https://a.example) x",
    );
  });

  it("writes image syntax when asked", () => {
    expect(run("|", { kind: "link", image: true })).toBe("![]([url])");
  });

  // The same question the toolbar's Image entry asks before it decides between
  // writing `![](…)` and opening the photo browser.
  it("recognises an address, and nothing else, as a link", () => {
    expect(isUrlText("https://a.example/x")).toBe(true);
    expect(isUrlText("HTTP://a.example")).toBe(true);
    expect(isUrlText("www.a.example")).toBe(true);
    expect(isUrlText("")).toBe(false);
    expect(isUrlText("a picture of a cat")).toBe(false);
    expect(isUrlText("https://a.example with words")).toBe(false);
  });
});

describe("lineFormatAt", () => {
  it("reports the block kind and heading level", () => {
    expect(lineFormatAt(["## title", "- item"], 0)).toEqual({
      kind: "heading",
      level: 2,
      indent: 0,
      inline: [],
    });
  });

  it("reports the indent of a nested item", () => {
    expect(lineFormatAt(["- a", "  - b"], 1)).toEqual({
      kind: "ul",
      level: undefined,
      indent: 2,
      inline: [],
    });
  });

  it("classifies inside a fence as code, not as markdown", () => {
    expect(lineFormatAt(["```", "# not a heading", "```"], 1)?.kind).toBe(
      "code",
    );
  });

  it("returns null past the end", () => {
    expect(lineFormatAt(["a"], 4)).toBeNull();
  });
});

describe("newlineFor", () => {
  // What Enter inserts with the caret at `col` of the line at `line`.
  const enterAt = (source: string, line: number, col: number) =>
    newlineFor(classifyLines(source), line, col);
  // The same, with Shift held.
  const softAt = (source: string, line: number, col: number) =>
    newlineFor(classifyLines(source), line, col, true);
  const inserts = (text: string) => ({ kind: "insert", text });

  it("inserts a bare newline on an unmarked line", () => {
    expect(enterAt("plain text", 0, 5)).toEqual(inserts("\n"));
    expect(enterAt("# heading", 0, 9)).toEqual(inserts("\n"));
    expect(newlineFor([], 0, 0)).toEqual(inserts("\n"));
  });

  it("carries the quote marker onto the next row", () => {
    expect(enterAt("> quoted", 0, 8)).toEqual(inserts("\n> "));
    expect(enterAt("> quoted", 0, 4)).toEqual(inserts("\n> "));
  });

  it("reproduces the marker as it was written, indent included", () => {
    expect(enterAt("  > quoted", 0, 10)).toEqual(inserts("\n  > "));
    expect(enterAt(">tight", 0, 6)).toEqual(inserts("\n>"));
  });

  it("keeps quoting from an empty quote row (leaving one is explicit)", () => {
    expect(enterAt("> a\n> ", 1, 2)).toEqual(inserts("\n> "));
  });

  it("leaves a caret inside the marker alone, so the row is pushed down", () => {
    expect(enterAt("> quoted", 0, 0)).toEqual(inserts("\n"));
    expect(enterAt("> quoted", 0, 1)).toEqual(inserts("\n"));
    expect(enterAt("- item", 0, 1)).toEqual(inserts("\n"));
    expect(enterAt("1. item", 0, 2)).toEqual(inserts("\n"));
  });

  it("does not quote a `>` line inside a fenced code block", () => {
    expect(enterAt("```\n> not a quote\n```", 1, 14)).toEqual(inserts("\n"));
  });

  it("opens another bullet, keeping the bullet character and indent", () => {
    expect(enterAt("- item", 0, 6)).toEqual(inserts("\n- "));
    expect(enterAt("* item", 0, 6)).toEqual(inserts("\n* "));
    expect(enterAt("    + item", 0, 10)).toEqual(inserts("\n    + "));
  });

  it("splits a bullet mid-row, so the tail becomes the next item", () => {
    expect(enterAt("- onetwo", 0, 5)).toEqual(inserts("\n- "));
  });

  it("opens another task row, always with an empty box", () => {
    expect(enterAt("- [ ] milk", 0, 10)).toEqual(inserts("\n- [ ] "));
    // The tick never travels: a fresh item starts open, whatever the row
    // above it ended up as.
    expect(enterAt("- [x] milk", 0, 10)).toEqual(inserts("\n- [ ] "));
    expect(enterAt("  * [X] milk", 0, 12)).toEqual(inserts("\n  * [ ] "));
  });

  it("clears an empty task row, so Enter twice leaves the checklist", () => {
    expect(enterAt("- [ ] a\n- [ ] ", 1, 6)).toEqual({
      kind: "replaceLine",
      line: "",
    });
  });

  it("keeps the whole box in the marker, so Enter inside it pushes the row down", () => {
    expect(enterAt("- [ ] milk", 0, 3)).toEqual(inserts("\n"));
  });

  it("blanks the box out with the rest of the marker on Shift+Enter", () => {
    expect(softAt("- [x] milk", 0, 10)).toEqual(inserts("\n      "));
  });

  it("ends the list from an empty item even with Shift held", () => {
    // Shift+Enter opens a row *inside* the item you are on — but an empty item
    // has nothing for that row to hang under, so leaving the list wins. This
    // is also the way out on a phone, where iOS auto-capitalisation leaves the
    // keyboard's shift engaged at the start of a blank row and its Return
    // reports a Shift nobody pressed.
    const cleared = { kind: "replaceLine", line: "" };
    expect(softAt("- [ ] a\n- [ ] ", 1, 6)).toEqual(cleared);
    expect(softAt("- a\n- ", 1, 2)).toEqual(cleared);
    expect(softAt("1. a\n2. ", 1, 3)).toEqual(cleared);
    // ...and a nested one still steps out a level first, as plain Enter does.
    expect(softAt("- [ ] a\n  - [ ] ", 1, 8)).toEqual({
      kind: "replaceLine",
      line: "- [ ] ",
    });
  });

  it("still opens a continuation row from an item that has content", () => {
    expect(softAt("- [ ] milk", 0, 10)).toEqual(inserts("\n      "));
    expect(softAt("- milk", 0, 6)).toEqual(inserts("\n  "));
  });

  it("bumps the number on an ordered item", () => {
    expect(enterAt("1. item", 0, 7)).toEqual(inserts("\n2. "));
    expect(enterAt("9. item", 0, 7)).toEqual(inserts("\n10. "));
    expect(enterAt("  3) item", 0, 9)).toEqual(inserts("\n  4) "));
  });

  it("clears a top-level empty item, so Enter twice leaves the list", () => {
    expect(enterAt("- a\n- ", 1, 2)).toEqual({ kind: "replaceLine", line: "" });
    expect(enterAt("1. a\n2. ", 1, 3)).toEqual({
      kind: "replaceLine",
      line: "",
    });
  });

  it("pulls a nested empty item back out one level", () => {
    expect(enterAt("- a\n  - ", 1, 4)).toEqual({
      kind: "replaceLine",
      line: "- ",
    });
    expect(enterAt("- a\n\t- ", 1, 3)).toEqual({
      kind: "replaceLine",
      line: "- ",
    });
  });

  it("reads an emptied `- ` row under a list as a bullet, not a divider", () => {
    expect(enterAt("- a\n- ", 1, 2)).toEqual({ kind: "replaceLine", line: "" });
    expect(enterAt("- a\n\n- ", 2, 2)).toEqual({
      kind: "replaceLine",
      line: "",
    });
  });

  it("leaves a lone `-` divider alone when no list is open above it", () => {
    expect(enterAt("prose\n- ", 1, 2)).toEqual(inserts("\n"));
    expect(enterAt("- ", 0, 2)).toEqual(inserts("\n"));
  });

  it("keeps a hand-typed `-` a divider even with a list open above it", () => {
    // The gap after the marker is what Enter writes and what a person typing a
    // divider never types, so a bare `-` stays a rule wherever it lands — under
    // a list, under a blank line after one, nested, or under a checklist.
    // Reading it as an empty bullet would eat the character just typed.
    expect(enterAt("- a\n-", 1, 1)).toEqual(inserts("\n"));
    expect(enterAt("- a\n\n-", 2, 1)).toEqual(inserts("\n"));
    expect(enterAt("1. a\n-", 1, 1)).toEqual(inserts("\n"));
    expect(enterAt("- a\n  -", 1, 3)).toEqual(inserts("\n"));
    expect(enterAt("- [ ] a\n-", 1, 1)).toEqual(inserts("\n"));
    // ...and Shift changes nothing about it.
    expect(softAt("- a\n-", 1, 1)).toEqual(inserts("\n"));
  });

  it("opens a continuation row inside the item on Shift+Enter", () => {
    expect(softAt("- item", 0, 6)).toEqual(inserts("\n  "));
    expect(softAt("  10. item", 0, 10)).toEqual(inserts("\n      "));
    expect(softAt("\t- item", 0, 7)).toEqual(inserts("\n\t  "));
  });

  it("keeps the marker on Shift+Enter in a quote — a bare row is not quoted", () => {
    expect(softAt("> quoted", 0, 8)).toEqual(inserts("\n> "));
  });

  it("leaves Shift+Enter bare on an unmarked line", () => {
    expect(softAt("plain text", 0, 5)).toEqual(inserts("\n"));
  });
});
