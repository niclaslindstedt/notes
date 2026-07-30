import { describe, expect, it } from "vitest";

import {
  applyFormat,
  lineFormatAt,
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
  const open = marked.indexOf("[");
  const close = marked.indexOf("]") - 1;
  const text = marked.replace("[", "").replace("]", "");
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

  it("leaves a blank line alone rather than making it whitespace", () => {
    expect(run("[- a\n\n- b]", { kind: "indent" })).toBe("[  - a\n\n  - b]");
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
});

describe("lineFormatAt", () => {
  it("reports the block kind and heading level", () => {
    expect(lineFormatAt(["## title", "- item"], 0)).toEqual({
      kind: "heading",
      level: 2,
      indent: 0,
    });
  });

  it("reports the indent of a nested item", () => {
    expect(lineFormatAt(["- a", "  - b"], 1)).toEqual({
      kind: "ul",
      level: undefined,
      indent: 2,
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
