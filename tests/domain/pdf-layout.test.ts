import { describe, expect, it } from "vitest";

import {
  layoutPdf,
  type DrawOp,
  type PdfLayout,
  type TextMeasurer,
} from "../../src/domain/pdf-layout.ts";
import {
  DEFAULT_PDF_SETTINGS,
  type PdfSettings,
} from "../../src/domain/pdf.ts";
import { compileTransforms } from "../../src/domain/transform.ts";

// A stand-in for jsPDF's metrics: every glyph is half the font size wide. The
// layout only ever asks "how wide is this", so a predictable answer makes the
// wrapping arithmetic something a test can reason about.
const measure: TextMeasurer = (text, _font, sizePt) =>
  text.length * sizePt * 0.5;

// Margins that leave a ~110pt column on A4 — 20 characters a line at the
// default 11pt, which is narrow enough to make wrapping happen in one short
// sentence. Not one of the offered margins; the layout takes what it is given.
const NARROW = 85.64;

function layout(
  body: string,
  overrides: Partial<PdfSettings> = {},
  extra: Partial<Parameters<typeof layoutPdf>[0]> = {},
): PdfLayout {
  return layoutPdf({
    title: "",
    body,
    settings: { ...DEFAULT_PDF_SETTINGS, ...overrides },
    measure,
    ...extra,
  });
}

function texts(result: PdfLayout, page = 0): string[] {
  return (result.pages[page]?.ops ?? [])
    .filter((op): op is Extract<DrawOp, { kind: "text" }> => op.kind === "text")
    .map((op) => op.text);
}

function opsOfKind<K extends DrawOp["kind"]>(
  result: PdfLayout,
  kind: K,
  page = 0,
): Extract<DrawOp, { kind: K }>[] {
  return (result.pages[page]?.ops ?? []).filter(
    (op): op is Extract<DrawOp, { kind: K }> => op.kind === kind,
  );
}

describe("layoutPdf", () => {
  it("gives an empty note one blank page", () => {
    const result = layout("");
    expect(result.pages).toHaveLength(1);
    // Only the page number — nothing else is written into the margins.
    expect(texts(result)).toEqual(["1 / 1"]);
  });

  it("measures the sheet in points, orientation applied", () => {
    const portrait = layout("hi");
    expect(portrait.widthPt).toBeCloseTo(595.28);
    const landscape = layout("hi", { orientation: "landscape" });
    expect(landscape.widthPt).toBeCloseTo(841.89);
  });

  it("heads the page with the title only when asked", () => {
    expect(
      texts(
        layoutPdf({
          title: "Groceries",
          body: "milk",
          settings: DEFAULT_PDF_SETTINGS,
          measure,
        }),
      ),
    ).toContain("Groceries");
    expect(
      texts(
        layoutPdf({
          title: "Groceries",
          body: "milk",
          settings: { ...DEFAULT_PDF_SETTINGS, includeTitle: false },
          measure,
        }),
      ),
    ).not.toContain("Groceries");
  });

  describe("page furniture", () => {
    it("numbers every page, with the total", () => {
      const result = layout("line one\n\nline two");
      expect(texts(result)).toContain("1 / 1");
    });

    it("writes nothing at all when numbering is off", () => {
      const result = layout("hello", { pageNumbers: false });
      expect(texts(result)).toEqual(["hello"]);
    });

    it("puts the number in the bottom margin, clear of the text", () => {
      const result = layout("hello");
      const footer = opsOfKind(result, "text").find(
        (op) => op.text === "1 / 1",
      );
      const contentBottom = result.heightPt - (20 * 72) / 25.4;
      expect(footer!.y).toBeGreaterThan(contentBottom);
      expect(footer!.y).toBeLessThan(result.heightPt);
    });
  });

  describe("wrapping", () => {
    it("breaks a long line at word boundaries", () => {
      const result = layout("aaaa bbbb cccc dddd eeee ffff", {
        marginMm: NARROW,
      });
      expect(texts(result).slice(0, 2)).toEqual([
        "aaaa bbbb cccc dddd",
        "eeee ffff",
      ]);
    });

    it("cuts a word that cannot fit any line", () => {
      const result = layout("x".repeat(50), { marginMm: NARROW });
      const lines = texts(result).filter((t) => t.startsWith("x"));
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.join("")).toBe("x".repeat(50));
    });

    it("keeps the newlines a writer typed as hard breaks", () => {
      const result = layout("short\nlines\nhere");
      expect(texts(result).slice(0, 3)).toEqual(["short", "lines", "here"]);
    });
  });

  describe("blocks", () => {
    it("sets a heading bigger and bolder than the body", () => {
      const result = layout("# Title\n\nbody");
      const [heading, body] = opsOfKind(result, "text");
      expect(heading!.sizePt).toBeGreaterThan(body!.sizePt);
      expect(heading!.font.bold).toBe(true);
      expect(body!.font.bold).toBe(false);
    });

    it("sets headings in their own family when one is chosen", () => {
      const result = layout("# Title\n\nbody", {
        bodyFont: "serif",
        headingFont: "mono",
      });
      const [heading, body] = opsOfKind(result, "text");
      expect(heading!.font.family).toBe("courier");
      expect(body!.font.family).toBe("times");
    });

    it("draws a rule for a horizontal rule", () => {
      const result = layout("a\n\n---\n\nb");
      const rules = opsOfKind(result, "rect").filter((op) => op.height < 1);
      expect(rules).toHaveLength(1);
      expect(rules[0]!.width).toBeCloseTo(
        result.widthPt - (2 * 20 * 72) / 25.4,
      );
    });

    it("fills a code block behind its lines", () => {
      const result = layout("```\nconst x = 1;\n```");
      const fill = opsOfKind(result, "rect").find(
        (op) => op.fill === DEFAULT_PDF_SETTINGS.codeBackground,
      );
      expect(fill).toBeDefined();
      expect(texts(result)).toContain("const x = 1;");
    });

    it("leaves code unfilled when the background is none", () => {
      const result = layout("```\ncode\n```", {
        codeBackground: "transparent",
      });
      expect(opsOfKind(result, "rect")).toHaveLength(0);
    });

    it("bars a quote down its left edge", () => {
      const result = layout("> quoted");
      const bar = opsOfKind(result, "rect").find((op) => op.width < 5);
      expect(bar).toBeDefined();
      expect(texts(result)).toContain("quoted");
    });
  });

  describe("lists", () => {
    it("draws a bullet rather than setting one as text", () => {
      const result = layout("- milk");
      expect(texts(result)).toEqual(["milk", "1 / 1"]);
      expect(opsOfKind(result, "ellipse")).toHaveLength(1);
    });

    it("rotates the marker shape as items nest", () => {
      const result = layout("- one\n  - two\n    - three");
      // disc and circle are both ellipses; the third level is a square.
      expect(opsOfKind(result, "ellipse")).toHaveLength(2);
      expect(
        opsOfKind(result, "rect").filter((op) => op.fill === "#111111"),
      ).toHaveLength(1);
    });

    it("indents each level further than the last", () => {
      const result = layout("- one\n  - two");
      const [outer, inner] = opsOfKind(result, "text");
      expect(inner!.x).toBeGreaterThan(outer!.x);
    });

    it("sets an ordered list's computed markers as text", () => {
      const result = layout("1. one\n1. two");
      expect(texts(result)).toEqual(["one", "1.", "two", "2.", "1 / 1"]);
    });

    it("draws a task box, ticked or not", () => {
      const result = layout("- [ ] todo\n- [x] done");
      const boxes = opsOfKind(result, "rect").filter((op) => op.stroke);
      expect(boxes).toHaveLength(2);
      // Only the ticked one carries a tick path.
      expect(opsOfKind(result, "path")).toHaveLength(1);
    });
  });

  describe("inline", () => {
    it("carries bold and italic into the run's font", () => {
      const result = layout("plain **bold** *italic*");
      const runs = opsOfKind(result, "text");
      const run = (text: string) => runs.find((r) => r.text.trim() === text)!;
      expect(run("bold").font.bold).toBe(true);
      expect(run("italic").font.italic).toBe(true);
      expect(run("plain").font.bold).toBe(false);
    });

    it("sets inline code in the code family, smaller", () => {
      const result = layout("run `npm test` now");
      const code = opsOfKind(result, "text").find((r) => r.text === "npm test");
      expect(code!.font.family).toBe("courier");
      expect(code!.sizePt).toBeCloseTo(
        DEFAULT_PDF_SETTINGS.fontSizePt * DEFAULT_PDF_SETTINGS.codeFontScale,
      );
    });

    it("makes a link clickable and underlines it", () => {
      const result = layout("see [docs](https://example.com) here");
      const links = opsOfKind(result, "link");
      expect(links).toHaveLength(1);
      expect(links[0]!.href).toBe("https://example.com");
    });

    it("refuses a link scheme that means nothing on paper", () => {
      const result = layout("[x](javascript:alert(1))");
      expect(opsOfKind(result, "link")).toHaveLength(0);
      expect(texts(result)).toContain("x");
    });
  });

  describe("images", () => {
    it("scales a picture to the column and reserves its height", () => {
      const result = layout("![shot](attachments/shot.png)", undefined, {
        resolveImage: () => ({
          key: "shot.png",
          widthPx: 2000,
          heightPx: 1000,
        }),
      });
      const [image] = opsOfKind(result, "image");
      const contentWidth = result.widthPt - (2 * 20 * 72) / 25.4;
      expect(image!.width).toBeCloseTo(contentWidth);
      expect(image!.height).toBeCloseTo(contentWidth / 2);
    });

    it("prints the alt text when the bytes never arrived", () => {
      const result = layout("![a diagram](attachments/gone.png)");
      expect(opsOfKind(result, "image")).toHaveLength(0);
      expect(texts(result)).toContain("[a diagram]");
    });
  });

  describe("paging", () => {
    it("starts a new page when the text runs off this one", () => {
      const body = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n");
      const result = layout(body);
      expect(result.pages.length).toBeGreaterThan(1);
      expect(texts(result, 0)).toContain("1 / " + result.pages.length);
    });

    it("keeps every drawn op inside its page box", () => {
      const body = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n");
      const result = layout(body);
      for (const page of result.pages) {
        for (const op of page.ops) {
          const y =
            op.kind === "ellipse" ? op.cy : op.kind === "path" ? 0 : op.y;
          expect(y).toBeLessThanOrEqual(result.heightPt);
        }
      }
    });

    it("does not strand a heading at the foot of a page", () => {
      // Fill the page, then a heading right at the bottom edge.
      const body = `${Array.from({ length: 44 }, (_, i) => `line ${i}`).join("\n")}\n\n# Section\n\nunder it`;
      const result = layout(body);
      const pageOf = (text: string) =>
        result.pages.findIndex((p) =>
          p.ops.some((op) => op.kind === "text" && op.text === text),
        );
      expect(pageOf("Section")).toBe(pageOf("under it"));
    });

    it("splits a code block too long for one page", () => {
      const lines = Array.from({ length: 90 }, (_, i) => `row ${i}`).join("\n");
      const result = layout("```\n" + lines + "\n```");
      expect(result.pages.length).toBeGreaterThan(1);
      // Each page carries its own fill behind the slice that landed on it.
      expect(
        opsOfKind(result, "rect", 1).some(
          (op) => op.fill === DEFAULT_PDF_SETTINGS.codeBackground,
        ),
      ).toBe(true);
    });
  });

  it("prints what the screen shows, not what was stored", () => {
    // A `sensitive` rule exists so the original never leaves the screen; a
    // document made to be handed out is where it must not reappear.
    const transforms = compileTransforms([
      {
        id: "t1",
        namespace: null,
        name: "id number",
        pattern: "\\d{6}-\\d{4}",
        ignoreCase: false,
        kind: "sensitive",
        replacement: "",
        mask: "all",
        sample: "990101-1234",
        enabled: true,
      },
    ]);
    const result = layout("id 990101-1234 here", undefined, { transforms });
    const drawn = texts(result).join(" ");
    expect(drawn).not.toContain("990101-1234");
    expect(drawn).toContain("***********");
  });
});
