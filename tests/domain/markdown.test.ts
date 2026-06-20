import { describe, expect, it } from "vitest";

import {
  classifyLines,
  parseInline,
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
