import { describe, expect, it } from "vitest";

import { renderPrintDocument } from "../../src/domain/pdf-render.ts";
import {
  DEFAULT_PDF_SETTINGS,
  type PdfSettings,
} from "../../src/domain/pdf.ts";

function render(body: string, settings: Partial<PdfSettings> = {}): string {
  return renderPrintDocument({
    title: "Note",
    body,
    settings: { ...DEFAULT_PDF_SETTINGS, ...settings },
  });
}

describe("renderPrintDocument", () => {
  it("emits a self-contained document with no external references", () => {
    const html = render("Hello");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style>");
    // Nothing may be fetched: the print engine waits for network it can't get
    // in a `srcdoc` frame, and the export would print half-styled.
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<script");
  });

  it("prints the title as a heading, or not, per the setting", () => {
    expect(render("Body")).toContain('<h1 class="doc-title">Note</h1>');
    expect(render("Body", { includeTitle: false })).not.toContain(
      '<h1 class="doc-title">',
    );
  });

  it("renders headings, rules and paragraphs", () => {
    const html = render("# Title\n\nFirst\nSecond\n\n---");
    expect(html).toContain("<h1>Title</h1>");
    // Consecutive prose lines are one paragraph with the newlines the writer
    // typed kept as hard breaks.
    expect(html).toContain("<p>First<br>Second</p>");
    expect(html).toContain("<hr>");
  });

  it("renders inline formatting", () => {
    const html = render("**bold** *it* ~~gone~~ `code`");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>it</em>");
    expect(html).toContain("<del>gone</del>");
    expect(html).toContain("<code>code</code>");
  });

  it("renders a fenced code block as one literal <pre>", () => {
    const html = render("```\nconst a = 1 < 2;\nconst b = a;\n```");
    expect(html).toContain(
      "<pre><code>const a = 1 &lt; 2;\nconst b = a;</code></pre>",
    );
    // The fence delimiters themselves are markup, not content.
    expect(html).not.toContain("```");
  });

  it("closes an unterminated fence at the end of the note", () => {
    const html = render("```\nstill code");
    expect(html).toContain("<pre><code>still code</code></pre>");
  });

  it("nests lists by the depth the parser assigned", () => {
    const html = render("- one\n  - deep\n- two");
    expect(html).toContain(
      '<ul><li data-bullet="0"><span class="marker"></span>one' +
        '<ul><li data-bullet="1"><span class="marker"></span>deep</li></ul>' +
        '</li><li data-bullet="0"><span class="marker"></span>two</li></ul>',
    );
  });

  it("keeps a uniformly indented list flat", () => {
    // Every item is at the same depth, so the second must be a sibling of the
    // first rather than hanging off it.
    const html = render("  - one\n  - two");
    expect(html).toContain("</li><li");
    expect(html.match(/<ul>/g)).toHaveLength(1);
  });

  it("numbers ordered lists the way the editor showed them", () => {
    const html = render("1. one\n1. two\n1. three");
    expect(html).toContain('<span class="marker">1.</span>one');
    expect(html).toContain('<span class="marker">2.</span>two');
    expect(html).toContain('<span class="marker">3.</span>three');
  });

  it("prints task items as boxes showing their state", () => {
    const html = render("- [ ] todo\n- [x] done");
    expect(html).toContain(
      '<li class="task"><span class="marker">☐</span>todo',
    );
    expect(html).toContain(
      '<li class="task"><span class="marker">☑</span>done',
    );
  });

  it("gathers consecutive quote lines into one blockquote", () => {
    const html = render("> one\n> two");
    expect(html).toContain("<blockquote><p>one<br>two</p></blockquote>");
  });

  it("escapes note text rather than letting it become markup", () => {
    const html = render("<script>alert(1)</script> & more");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; more");
    expect(html).not.toContain("<script>alert");
  });

  it("keeps only inert link schemes", () => {
    expect(render("[ok](https://example.com)")).toContain(
      '<a href="https://example.com">ok</a>',
    );
    // A script URL prints as plain text — the label survives, the href doesn't.
    const evil = render("[click](javascript:alert(1))");
    expect(evil).toContain("click");
    expect(evil).not.toContain("javascript:");
  });

  it("degrades an unresolvable image to its alt text", () => {
    const html = render("![a picture](attachments/photo.png)");
    expect(html).toContain('<span class="missing-image">[a picture]</span>');
    expect(html).not.toContain("<img");
  });

  it("draws an image the caller resolved", () => {
    const html = renderPrintDocument({
      title: "Note",
      body: "![shot](attachments/photo.png)",
      settings: DEFAULT_PDF_SETTINGS,
      resolveImage: () => "data:image/png;base64,AAA",
    });
    expect(html).toContain('<img src="data:image/png;base64,AAA" alt="shot">');
  });

  it("projects the settings onto the stylesheet", () => {
    const html = render("text", {
      pageSize: "letter",
      orientation: "landscape",
      marginMm: 12.7,
      fontSizePt: 14,
      lineHeight: 1.8,
      codeBackground: "#eef2f7",
      bullet: "square",
    });
    expect(html).toContain("@page{size:Letter landscape;margin:12.7mm}");
    expect(html).toContain("font-size:14pt");
    expect(html).toContain("line-height:1.8");
    expect(html).toContain("background:#eef2f7");
    expect(html).toContain('li[data-bullet="0"]>.marker::before{content:"▪"}');
  });

  it("drops the code fill entirely when the background is none", () => {
    const html = render("`x`", { codeBackground: "transparent" });
    expect(html).not.toContain("background:transparent");
    expect(html).toContain("pre{");
  });
});
