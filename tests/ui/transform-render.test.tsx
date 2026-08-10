// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/preact";

import { classifyLines } from "../../src/domain/markdown.ts";
import {
  compileTransforms,
  emptyTransformRule,
  type TransformRule,
} from "../../src/domain/transform.ts";
import { RenderedLine } from "../../src/ui/MarkdownLine.tsx";

afterEach(cleanup);

function rule(patch: Partial<TransformRule>): TransformRule {
  return { ...emptyTransformRule("r1"), ...patch };
}

const ISSUE_RULE = rule({
  pattern: "#(\\d+)",
  kind: "link",
  replacement: "https://example.test/issues/$1",
});

function renderLine(source: string, rules: TransformRule[]) {
  const [block] = classifyLines(source);
  return render(
    <RenderedLine block={block!} transforms={compileTransforms(rules)} />,
  );
}

describe("transformed lines", () => {
  it("renders a link rule as an anchor to the expanded template", () => {
    const { container } = renderLine("fixed #134 today", [ISSUE_RULE]);
    const anchor = container.querySelector("a")!;
    expect(anchor.getAttribute("href")).toBe("https://example.test/issues/134");
    // The matched source is what stays on screen, and what the title reveals.
    expect(anchor.textContent).toBe("#134");
    expect(anchor.getAttribute("title")).toBe("#134");
  });

  it("maps a transformed run back to its source span", () => {
    const { container } = renderLine("fixed #134", [ISSUE_RULE]);
    const anchor = container.querySelector("a")!;
    // `data-src` is the match's first source column; `data-len` its source
    // length, so a selection across it copies what was typed.
    expect(anchor.getAttribute("data-src")).toBe("6");
    expect(anchor.getAttribute("data-len")).toBe("4");
  });

  it("masks a sensitive rule and never reveals the source on hover", () => {
    const { container } = renderLine("call 0761234123 now", [
      rule({ pattern: "\\d{10}", kind: "sensitive", mask: "ends" }),
    ]);
    expect(container.textContent).toBe("call 076****123 now");
    expect(container.querySelector("[title]")).toBeNull();
  });

  it("replaces a text rule with the expanded template", () => {
    renderLine("TODO(nic) ship it", [
      rule({ pattern: "TODO\\((\\w+)\\)", kind: "text", replacement: "→ $1" }),
    ]);
    expect(screen.getByText("→ nic")).toBeTruthy();
  });

  it("leaves a fenced code line alone", () => {
    const blocks = classifyLines("```\nfixed #134\n```");
    const { container } = render(
      <RenderedLine
        block={blocks[1]!}
        transforms={compileTransforms([ISSUE_RULE])}
      />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("fixed #134");
  });

  it("renders the source verbatim with no rules configured", () => {
    const { container } = renderLine("fixed #134 today", []);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("fixed #134 today");
  });

  it("still fires inside a list item and inside emphasis", () => {
    const { container } = renderLine("- **#134** is done", [ISSUE_RULE]);
    expect(container.querySelector("strong a")).toBeTruthy();
  });
});
