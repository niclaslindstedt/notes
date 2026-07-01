// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { classifyLines } from "../../src/domain/markdown.ts";
import { MarkdownEditor } from "../../src/ui/MarkdownEditor.tsx";
import {
  extractSourceRange,
  snapStartToLineEdge,
  sourcePointFromDom,
  type SourcePoint,
} from "../../src/ui/markdown-selection.ts";

const editorProps = {
  wordWrap: true,
  disableSpellcheck: false,
  disableAutocorrect: false,
  maxWidth: "none",
} as const;

describe("extractSourceRange", () => {
  function range(body: string, a: SourcePoint, b: SourcePoint): string {
    return extractSourceRange(body.split("\n"), a, b);
  }

  it("slices within a single line", () => {
    expect(range("hello world", { line: 0, col: 0 }, { line: 0, col: 5 })).toBe(
      "hello",
    );
  });

  it("orders reversed endpoints", () => {
    expect(range("hello world", { line: 0, col: 5 }, { line: 0, col: 0 })).toBe(
      "hello",
    );
  });

  it("joins multiple lines, taking the remainder and head of the ends", () => {
    const body = "first line\nsecond line\nthird line";
    expect(range(body, { line: 0, col: 6 }, { line: 2, col: 5 })).toBe(
      "line\nsecond line\nthird",
    );
  });

  it("keeps list / heading markers on interior and end lines (verbatim source)", () => {
    // Copy round-trips as raw Markdown: an interior line keeps its "- " marker,
    // and the end line keeps its marker too (only the columns at the very start
    // and end of the selection are trimmed).
    const body = "- one\n- two\n- three";
    expect(range(body, { line: 0, col: 2 }, { line: 2, col: 5 })).toBe(
      "one\n- two\n- thr",
    );
  });

  it("copies a heading marker on a non-first selected line", () => {
    // The reported case: selecting across a paragraph into a heading keeps "# ".
    const body = "alpha\n# Heading";
    expect(range(body, { line: 0, col: 0 }, { line: 1, col: 9 })).toBe(
      "alpha\n# Heading",
    );
  });

  it("keeps blank lines as blank", () => {
    const body = "a\n\nb";
    expect(range(body, { line: 0, col: 0 }, { line: 2, col: 1 })).toBe(
      "a\n\nb",
    );
  });
});

describe("snapStartToLineEdge", () => {
  function snap(body: string, p: SourcePoint): SourcePoint {
    return snapStartToLineEdge(classifyLines(body), p);
  }

  it("extends a start at a heading's content over the '# ' marker", () => {
    // "# Heading": content starts at column 2; a selection reaching there has
    // taken the whole visible line, so include the marker.
    expect(snap("# Heading", { line: 0, col: 2 })).toEqual({ line: 0, col: 0 });
  });

  it("extends a start at a list item's content over the '- ' marker", () => {
    expect(snap("- item", { line: 0, col: 2 })).toEqual({ line: 0, col: 0 });
  });

  it("leaves a start that begins mid-content alone", () => {
    expect(snap("# Heading", { line: 0, col: 5 })).toEqual({ line: 0, col: 5 });
  });

  it("is a no-op on a marker-less paragraph", () => {
    expect(snap("plain text", { line: 0, col: 0 })).toEqual({
      line: 0,
      col: 0,
    });
    expect(snap("plain text", { line: 0, col: 3 })).toEqual({
      line: 0,
      col: 3,
    });
  });
});

describe("sourcePointFromDom", () => {
  // The editor opens its caret on the last line, so earlier lines render as the
  // formatted divs whose nodes we map back to source positions.
  function setup(body: string, shortenLinkChars = 0) {
    const { container } = render(
      <MarkdownEditor
        body={body}
        onChange={() => {}}
        shortenLinkChars={shortenLinkChars}
        {...editorProps}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    const blocks = classifyLines(body);
    return { root, blocks };
  }

  function leafText(root: HTMLElement, text: string): Text {
    const span = [...root.querySelectorAll("[data-src]")].find(
      (el) => el.textContent === text,
    );
    if (!span) throw new Error(`no leaf with text ${JSON.stringify(text)}`);
    return span.firstChild as Text;
  }

  it("maps a column inside a plain line", () => {
    const { root, blocks } = setup("hello world\nactive");
    const node = leafText(root, "hello world");
    expect(sourcePointFromDom(root, blocks, node, 0)).toEqual({
      line: 0,
      col: 0,
    });
    expect(sourcePointFromDom(root, blocks, node, 5)).toEqual({
      line: 0,
      col: 5,
    });
  });

  it("offsets the column past a list marker", () => {
    const { root, blocks } = setup("- item\nactive");
    const node = leafText(root, "item");
    // The "item" leaf starts at source column 2 (after "- ").
    expect(sourcePointFromDom(root, blocks, node, 0)).toEqual({
      line: 0,
      col: 2,
    });
  });

  it("maps the end of a shortened bare URL to the full source length", () => {
    const url = "https://example.com/very/long/path/segment/here/ok";
    const { root, blocks } = setup(`${url}\nactive`, 6);
    const anchor = root.querySelector("a[data-len]") as HTMLAnchorElement;
    expect(anchor).not.toBeNull();
    // It is actually shortened (rendered text shorter than the source URL).
    expect(anchor.textContent!.length).toBeLessThan(url.length);
    const node = anchor.firstChild as Text;
    // Landing at the visible end of the link snaps to the end of the full URL.
    const end = sourcePointFromDom(
      root,
      blocks,
      node,
      anchor.textContent!.length,
    );
    expect(end).toEqual({ line: 0, col: url.length });
  });

  it("returns null for a node outside the editor", () => {
    const { root, blocks } = setup("hello\nactive");
    const stray = document.createElement("div");
    stray.textContent = "x";
    document.body.appendChild(stray);
    expect(
      sourcePointFromDom(root, blocks, stray.firstChild as Text, 0),
    ).toBeNull();
  });
});
