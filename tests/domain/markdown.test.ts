import { describe, expect, it } from "vitest";

import {
  classifyLines,
  codeBlockCopyAnchors,
  codeBlockEdges,
  fencedRanges,
  hasClosedFence,
  hasMultiLineQuote,
  hiddenFenceLines,
  parseInline,
  shortenUrl,
  type InlineNode,
} from "../../src/domain/markdown.ts";

// Flatten the inline tree to the text it would render, so a test can assert
// structure without rebuilding the whole node graph by hand.
function flatten(nodes: InlineNode[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
        case "code":
        case "link":
          return n.text;
        case "image":
          return n.alt;
        default:
          return flatten(n.children);
      }
    })
    .join("");
}

describe("classifyLines", () => {
  it("classifies a heading with its level and content offset", () => {
    const [block] = classifyLines("## Hello");
    expect(block?.kind).toBe("heading");
    expect(block?.level).toBe(2);
    expect(block?.content).toBe("Hello");
    // "## " is three characters, so content starts at column 3.
    expect(block?.contentStart).toBe(3);
  });

  it("classifies unordered and ordered list items", () => {
    const [ul, ol] = classifyLines("- item\n1. first");
    expect(ul?.kind).toBe("ul");
    expect(ul?.content).toBe("item");
    expect(ul?.contentStart).toBe(2);
    expect(ol?.kind).toBe("ol");
    expect(ol?.ordinal).toBe("1.");
    expect(ol?.content).toBe("first");
  });

  it("classifies blockquotes, rules, and blank lines", () => {
    const [quote, hr, blank] = classifyLines("> quoted\n---\n");
    expect(quote?.kind).toBe("quote");
    expect(quote?.content).toBe("quoted");
    expect(hr?.kind).toBe("hr");
    expect(blank?.kind).toBe("blank");
  });

  it("treats a lone hyphen as a horizontal rule", () => {
    expect(classifyLines("-")[0]?.kind).toBe("hr");
    // Surrounding whitespace still counts as a bare divider…
    expect(classifyLines("  -  ")[0]?.kind).toBe("hr");
    // …but a hyphen with content after it is still a bullet.
    expect(classifyLines("- item")[0]?.kind).toBe("ul");
  });

  it("treats lines inside a fence as code, not Markdown", () => {
    const blocks = classifyLines("```\n# not a heading\n```");
    expect(blocks.map((b) => b.kind)).toEqual(["fence", "code", "fence"]);
    // The would-be heading keeps its raw text and isn't reparsed.
    expect(blocks[1]?.content).toBe("# not a heading");
  });

  it("falls back to paragraph for plain text", () => {
    const [block] = classifyLines("just words");
    expect(block?.kind).toBe("paragraph");
    expect(block?.contentStart).toBe(0);
  });
});

describe("fencedRanges", () => {
  it("pairs each opening fence with its closing one", () => {
    const blocks = classifyLines("a\n```\ncode\n```\nb\n~~~\nmore\n~~~");
    expect(fencedRanges(blocks)).toEqual([
      { open: 1, close: 3 },
      { open: 5, close: 7 },
    ]);
  });

  it("ignores an unterminated fence", () => {
    expect(fencedRanges(classifyLines("a\n```\ncode"))).toEqual([]);
    // The closed block before it is still reported.
    expect(fencedRanges(classifyLines("```\na\n```\n```\nb"))).toEqual([
      { open: 0, close: 2 },
    ]);
  });

  it("reports an empty block whose fences are adjacent", () => {
    expect(fencedRanges(classifyLines("```\n```"))).toEqual([
      { open: 0, close: 1 },
    ]);
  });
});

describe("hiddenFenceLines", () => {
  const blocks = classifyLines("a\n```\ncode\n```\nb");

  it("hides both fences of a block the caret is outside of", () => {
    expect([...hiddenFenceLines(blocks, 0)]).toEqual([1, 3]);
    expect([...hiddenFenceLines(blocks, 4)]).toEqual([1, 3]);
  });

  it("hides every block's fences when no line is active", () => {
    expect([...hiddenFenceLines(blocks, null)]).toEqual([1, 3]);
  });

  it("reveals both fences while the caret is inside the block", () => {
    // On the block's body…
    expect(hiddenFenceLines(blocks, 2).size).toBe(0);
    // …and on either delimiter itself.
    expect(hiddenFenceLines(blocks, 1).size).toBe(0);
    expect(hiddenFenceLines(blocks, 3).size).toBe(0);
  });

  it("reveals only the block the caret is in, leaving other blocks hidden", () => {
    const two = classifyLines("```\na\n```\nb\n```\nc\n```");
    expect([...hiddenFenceLines(two, 5)]).toEqual([0, 2]);
  });

  it("never hides an unterminated fence", () => {
    const open = classifyLines("a\n```\ncode");
    expect(hiddenFenceLines(open, 0).size).toBe(0);
  });
});

describe("codeBlockEdges", () => {
  // The edges as line indices, for readable assertions.
  function edges(body: string, activeLine: number | null) {
    const e = codeBlockEdges(classifyLines(body), activeLine);
    return { top: [...e.top], bottom: [...e.bottom] };
  }

  it("puts the edges on the code lines while the fences are folded away", () => {
    expect(edges("a\n```\none\ntwo\n```\nb", null)).toEqual({
      top: [2],
      bottom: [3],
    });
  });

  it("moves the edges onto the fences once the caret unfolds them", () => {
    expect(edges("a\n```\none\ntwo\n```\nb", 2)).toEqual({
      top: [1],
      bottom: [4],
    });
  });

  it("makes a one-line block its own top and bottom", () => {
    expect(edges("```\nonly\n```", null)).toEqual({ top: [1], bottom: [1] });
  });

  it("runs an unterminated block from its fence to the end of the note", () => {
    expect(edges("a\n```\nstill typing", null)).toEqual({
      top: [1],
      bottom: [2],
    });
  });

  it("gives a folded-away empty block no edges at all", () => {
    // Both fences hidden and nothing between them — nothing is drawn.
    expect(edges("a\n```\n```\nb", null)).toEqual({ top: [], bottom: [] });
    // With the caret inside, the fences are back and they are the edges.
    expect(edges("a\n```\n```\nb", 1)).toEqual({ top: [1], bottom: [2] });
  });

  it("closes every block's box independently", () => {
    expect(edges("```\na\n```\ntext\n```\nb\n```", null)).toEqual({
      top: [1, 5],
      bottom: [1, 5],
    });
  });
});

describe("codeBlockCopyAnchors", () => {
  it("anchors to the first code line while the fences are folded away", () => {
    const blocks = classifyLines("a\n```\none\ntwo\n```\nb");
    expect([...codeBlockCopyAnchors(blocks, null)]).toEqual([[2, "one\ntwo"]]);
    expect([...codeBlockCopyAnchors(blocks, 0)]).toEqual([[2, "one\ntwo"]]);
  });

  it("anchors to the opening fence once the caret unfolds it", () => {
    const blocks = classifyLines("a\n```\none\ntwo\n```\nb");
    expect([...codeBlockCopyAnchors(blocks, 3)]).toEqual([[1, "one\ntwo"]]);
  });

  it("steps past the active line rather than planting the button on it", () => {
    const blocks = classifyLines("a\n```\none\ntwo\n```\nb");
    // The caret is on the opening fence, so the button drops to the first
    // code line under it.
    expect([...codeBlockCopyAnchors(blocks, 1)]).toEqual([[2, "one\ntwo"]]);
  });

  it("copies the code verbatim, fences and their info string excluded", () => {
    const blocks = classifyLines("```js\nconst a = 1;\n\n// #2\n```");
    expect(codeBlockCopyAnchors(blocks, null).get(1)).toBe(
      "const a = 1;\n\n// #2",
    );
  });

  it("gives every closed block its own button", () => {
    const blocks = classifyLines("```\na\n```\nb\n```\nc\n```");
    expect([...codeBlockCopyAnchors(blocks, null)]).toEqual([
      [1, "a"],
      [5, "c"],
    ]);
  });

  it("skips an empty block and an unterminated fence", () => {
    expect(codeBlockCopyAnchors(classifyLines("```\n```"), null).size).toBe(0);
    expect(codeBlockCopyAnchors(classifyLines("```\ncode"), null).size).toBe(0);
  });
});

describe("hasClosedFence", () => {
  it("is true only once a fence has been closed", () => {
    expect(hasClosedFence("")).toBe(false);
    expect(hasClosedFence("just words")).toBe(false);
    expect(hasClosedFence("```\ncode")).toBe(false);
    expect(hasClosedFence("```\ncode\n```")).toBe(true);
    expect(hasClosedFence("~~~js\ncode\n~~~")).toBe(true);
  });
});

describe("hasMultiLineQuote", () => {
  it("needs two consecutive quote rows", () => {
    expect(hasMultiLineQuote("")).toBe(false);
    expect(hasMultiLineQuote("> alone")).toBe(false);
    expect(hasMultiLineQuote("> one\nplain\n> two")).toBe(false);
    expect(hasMultiLineQuote("> one\n> two")).toBe(true);
    expect(hasMultiLineQuote("intro\n  > one\n  > two\nafter")).toBe(true);
  });

  it("ignores a `>` inside a fenced code block", () => {
    expect(hasMultiLineQuote("```\n> one\n> two\n```")).toBe(false);
  });
});

describe("classifyLines — list numbering", () => {
  it("renumbers an ordered list sequentially regardless of the source digits", () => {
    const blocks = classifyLines("1. a\n1. b\n1. c");
    expect(blocks.map((b) => b.marker)).toEqual(["1.", "2.", "3."]);
    // The typed marker is preserved for offset/source use.
    expect(blocks.map((b) => b.ordinal)).toEqual(["1.", "1.", "1."]);
  });

  it("honours the first item's number as the list's start value", () => {
    const blocks = classifyLines("5. a\n1. b");
    expect(blocks.map((b) => b.marker)).toEqual(["5.", "6."]);
  });

  it("keeps numbering across a blank line but restarts after other content", () => {
    const across = classifyLines("1. a\n\n1. b");
    expect(across.filter((b) => b.kind === "ol").map((b) => b.marker)).toEqual([
      "1.",
      "2.",
    ]);
    const broken = classifyLines("1. a\ntext\n1. b");
    expect(broken.filter((b) => b.kind === "ol").map((b) => b.marker)).toEqual([
      "1.",
      "1.",
    ]);
  });

  it("rotates ordered markers by depth: numeric → alpha → roman", () => {
    const blocks = classifyLines(
      "1. a\n1. b\n  1. b-a\n  1. b-b\n    1. b-b-a\n    1. b-b-b",
    );
    const ol = blocks.filter((b) => b.kind === "ol");
    expect(ol.map((b) => b.depth)).toEqual([0, 0, 1, 1, 2, 2]);
    expect(ol.map((b) => b.marker)).toEqual([
      "1.",
      "2.",
      "a.",
      "b.",
      "i.",
      "ii.",
    ]);
  });

  it("restarts a nested list's counter each time it opens", () => {
    const blocks = classifyLines("1. a\n  1. a-a\n2. b\n  1. b-a");
    const ol = blocks.filter((b) => b.kind === "ol");
    expect(ol.map((b) => b.marker)).toEqual(["1.", "a.", "2.", "a."]);
  });

  it("assigns unordered items a nesting depth from indentation", () => {
    const blocks = classifyLines("- a\n  - b\n    - c\n- d");
    expect(blocks.map((b) => b.depth)).toEqual([0, 1, 2, 0]);
  });
});

describe("parseInline", () => {
  it("parses bold, italic, and bold-italic", () => {
    expect(parseInline("**b**")[0]).toMatchObject({ type: "strong" });
    expect(parseInline("*i*")[0]).toMatchObject({ type: "em" });
    const tri = parseInline("***x***")[0];
    expect(tri).toMatchObject({ type: "strong" });
    expect(flatten([tri!])).toBe("x");
  });

  it("parses inline code and strikethrough", () => {
    expect(parseInline("`code`")[0]).toMatchObject({
      type: "code",
      text: "code",
    });
    expect(parseInline("~~gone~~")[0]).toMatchObject({
      type: "strikethrough",
    });
  });

  it("parses links into text and href", () => {
    expect(parseInline("[label](https://x.y)")[0]).toMatchObject({
      type: "link",
      text: "label",
      href: "https://x.y",
    });
  });

  it("autolinks a bare http(s) URL, displaying it verbatim", () => {
    expect(parseInline("http://google.se")[0]).toMatchObject({
      type: "link",
      text: "http://google.se",
      href: "http://google.se",
      offset: 0,
      // Flagged bare so the renderer may shorten it.
      bare: true,
    });
    expect(parseInline("https://x.y")[0]).toMatchObject({
      type: "link",
      href: "https://x.y",
    });
  });

  it("autolinks a bare www. URL with an https:// href", () => {
    expect(parseInline("www.example.com")[0]).toMatchObject({
      type: "link",
      text: "www.example.com",
      href: "https://www.example.com",
    });
  });

  it("keeps surrounding text and trailing punctuation outside the autolink", () => {
    const nodes = parseInline("see http://google.se now");
    expect(nodes.map((n) => n.type)).toEqual(["text", "link", "text"]);
    expect(nodes[1]).toMatchObject({ type: "link", text: "http://google.se" });

    // A sentence-ending period isn't part of the URL.
    const [, dotLink, tail] = parseInline("visit http://x.y.");
    expect(dotLink).toMatchObject({ type: "link", href: "http://x.y" });
    expect(tail).toMatchObject({ type: "text", text: "." });

    // An unbalanced closing paren stays with the wrapping text.
    const wrapped = parseInline("(http://x.y)");
    expect(wrapped[1]).toMatchObject({ type: "link", href: "http://x.y" });
    expect(wrapped[2]).toMatchObject({ type: "text", text: ")" });
  });

  it("does not autolink a scheme glued to the end of a word", () => {
    // "ahttp://x" must stay plain text, not link from the inner "http".
    expect(parseInline("ahttp://x.y").every((n) => n.type === "text")).toBe(
      true,
    );
  });

  it("still prefers an explicit [text](url) link over autolinking", () => {
    const [node] = parseInline("[label](http://x.y)");
    expect(node).toMatchObject({
      type: "link",
      text: "label",
      href: "http://x.y",
    });
    // An explicit link is never flagged bare, so its label is never shortened.
    expect((node as { bare?: true }).bare).toBeUndefined();
  });

  it("parses an image into alt and href, distinct from a link", () => {
    const [node] = parseInline("![my pic](attachments/abcd-pic.png)");
    expect(node).toMatchObject({
      type: "image",
      alt: "my pic",
      href: "attachments/abcd-pic.png",
      offset: 0,
    });
  });

  it("keeps surrounding text around an inline image", () => {
    const nodes = parseInline("see ![pic](attachments/a.png) here");
    expect(nodes.map((n) => n.type)).toEqual(["text", "image", "text"]);
  });

  it("records absolute source offsets on leaf nodes", () => {
    // "ab **c**" — the bold content "c" sits at column 5 in the source.
    const nodes = parseInline("ab **c**");
    const strong = nodes.find((n) => n.type === "strong");
    expect(strong?.type).toBe("strong");
    if (strong?.type === "strong") {
      expect(strong.children[0]).toMatchObject({ type: "text", offset: 5 });
    }
  });

  it("offsets respect the base column of the line content", () => {
    // Heading content "Hi" begins at column 2 ("# Hi"), passed as base.
    const [node] = parseInline("Hi", 2);
    expect(node).toMatchObject({ type: "text", text: "Hi", offset: 2 });
  });

  it("does not treat underscores inside a word as emphasis", () => {
    const nodes = parseInline("a_b_c");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ type: "text", text: "a_b_c" });
  });

  it("leaves an unterminated delimiter as plain text", () => {
    const nodes = parseInline("**oops");
    expect(flatten(nodes)).toBe("**oops");
    expect(nodes.every((n) => n.type === "text")).toBe(true);
  });
});

describe("shortenUrl", () => {
  it("returns the URL unchanged when shortening is off (0 chars)", () => {
    const url = "https://www.example.com/a/very/long/path?q=1234567890";
    expect(shortenUrl(url, 0)).toBe(url);
  });

  it("keeps the domain plus N chars, an ellipsis, and the last N chars", () => {
    const url =
      "https://www.webhallen.com/se/product/397375-ON-CGK-100?utm_source=google&gclid=CjwKCAjw9NjRBhAT_p2J8XjINYQAvD_BwE";
    const out = shortenUrl(url, 11);
    expect(out).toBe("https://www.webhallen.com/se/product[...]INYQAvD_BwE");
    expect(out).toContain("[...]");
    expect(out.length).toBeLessThan(url.length);
  });

  it("derives the domain from a bare www. URL (no scheme)", () => {
    const url = "www.example.com/path/to/something/longer";
    const out = shortenUrl(url, 6);
    expect(out.startsWith("www.example.com")).toBe(true);
    expect(out).toContain("[...]");
  });

  it("leaves a short URL untouched rather than padding it", () => {
    // Head + ellipsis + tail would meet or overlap, so there's nothing to gain.
    const url = "https://x.io/abc";
    expect(shortenUrl(url, 8)).toBe(url);
  });

  it("never produces a result longer than the original", () => {
    const url = "https://host.example/" + "a".repeat(40);
    const out = shortenUrl(url, 4);
    expect(out.length).toBeLessThanOrEqual(url.length);
  });
});
