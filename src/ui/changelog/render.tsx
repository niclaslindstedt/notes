import { createElement, type ReactNode } from "react";

import {
  classifyLines,
  parseInline,
  type InlineNode,
} from "../../domain/markdown.ts";

// Render the changelog / feature-doc markdown for the "What's new" modal,
// reusing the app's one Markdown parser (`src/domain/markdown.ts`) rather than
// adding a second tokeniser. The domain layer turns source into nodes; this UI
// layer turns those nodes into React, scheme-checking link targets and wiring
// the `feature:<slug>` drill-down.
//
// The output is React nodes — never an HTML string handed to
// `dangerouslySetInnerHTML` — so it is XSS-safe by construction.

// Link targets we are willing to turn into a real anchor. Anything else
// (notably `javascript:` / `data:`) renders as inert literal text.
const URL_SAFE = /^(https?:\/\/|mailto:|\/|#|\.\/|\.\.\/)/i;

// A `[label](feature:<slug>)` link doesn't navigate — the changelog modal
// intercepts it to open the bundled feature doc inline. See `feature-docs.ts`.
export const FEATURE_LINK_SCHEME = "feature:";

// Per-render options. `onOpenFeature` wires the `feature:<slug>` link scheme to
// a handler (the modal's drill-down); without it such links render as inert
// literal text.
export type RenderOptions = {
  onOpenFeature?: (slug: string) => void;
};

function renderInlineNodes(
  nodes: InlineNode[],
  opts: RenderOptions,
  keyBase: string,
): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyBase}-${i}`;
    switch (node.type) {
      case "text":
        return <span key={key}>{node.text}</span>;
      case "code":
        return (
          <code
            key={key}
            className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[0.85em]"
          >
            {node.text}
          </code>
        );
      case "link": {
        const href = node.href.trim();
        // A `feature:<slug>` link opens the bundled doc in place rather than
        // navigating — render it as a button wired to the handler. With no
        // handler it falls through to inert text below.
        if (href.startsWith(FEATURE_LINK_SCHEME) && opts.onOpenFeature) {
          const slug = href.slice(FEATURE_LINK_SCHEME.length);
          const onOpenFeature = opts.onOpenFeature;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onOpenFeature(slug)}
              className="cursor-pointer text-link underline"
            >
              {node.text}
            </button>
          );
        }
        if (!URL_SAFE.test(href)) return <span key={key}>{node.text}</span>;
        return (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-link underline"
          >
            {node.text}
          </a>
        );
      }
      case "strong":
        return (
          <strong key={key} className="font-semibold text-fg-bright">
            {renderInlineNodes(node.children, opts, key)}
          </strong>
        );
      case "em":
        return <em key={key}>{renderInlineNodes(node.children, opts, key)}</em>;
      case "strikethrough":
        return (
          <del key={key}>{renderInlineNodes(node.children, opts, key)}</del>
        );
    }
  });
}

/**
 * Render a single line of markdown as inline React nodes — for a one-liner
 * that already sits inside a block the caller owns (a changelog `<li>`), where
 * {@link renderMarkdownDoc}'s block wrappers would be unwanted. Pass
 * `onOpenFeature` to wire the `feature:<slug>` "Learn more" drill-down.
 */
export function renderInlineMarkdown(
  source: string,
  opts: RenderOptions = {},
): ReactNode {
  return renderInlineNodes(parseInline(source), opts, "i");
}

/**
 * Render a full markdown document (a feature doc body) as React blocks. Groups
 * the domain parser's per-line classification into headings, lists,
 * blockquotes, fenced code, and paragraphs. Pass `onOpenFeature` to wire the
 * `feature:<slug>` scheme (a feature doc can cross-link to another).
 */
export function renderMarkdownDoc(
  source: string,
  opts: RenderOptions = {},
): ReactNode {
  const lines = classifyLines(source);
  const blocks: ReactNode[] = [];
  let i = 0;
  let n = 0;
  const nextKey = () => `b${n++}`;

  const inline = (text: string, key: string) =>
    renderInlineNodes(parseInline(text), opts, key);

  while (i < lines.length) {
    const block = lines[i]!;

    if (block.kind === "blank") {
      i++;
      continue;
    }

    if (block.kind === "hr") {
      blocks.push(<hr key={nextKey()} className="my-3 border-t border-line" />);
      i++;
      continue;
    }

    if (block.kind === "fence") {
      // Gather the fenced body up to the closing fence (or end of input).
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i]!.kind === "code") {
        body.push(lines[i]!.raw);
        i++;
      }
      if (i < lines.length && lines[i]!.kind === "fence") i++;
      blocks.push(
        <pre
          key={nextKey()}
          className="overflow-x-auto rounded bg-surface-3 p-2 font-mono text-[0.85em]"
        >
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (block.kind === "heading") {
      const key = nextKey();
      const tag = `h${Math.min((block.level ?? 1) + 1, 6)}`;
      blocks.push(
        createElement(
          tag,
          { key, className: "mt-3 mb-1 font-semibold text-fg-bright" },
          inline(block.content, key),
        ),
      );
      i++;
      continue;
    }

    if (block.kind === "quote") {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.kind === "quote") {
        quote.push(lines[i]!.content);
        i++;
      }
      blocks.push(
        <blockquote
          key={nextKey()}
          className="my-1 border-l-2 border-line pl-3 text-muted"
        >
          {renderMarkdownDoc(quote.join("\n"), opts)}
        </blockquote>,
      );
      continue;
    }

    if (block.kind === "ul" || block.kind === "ol") {
      const kind = block.kind;
      const key = nextKey();
      const items: ReactNode[] = [];
      while (i < lines.length && lines[i]!.kind === kind) {
        const itemKey = `${key}-${items.length}`;
        items.push(<li key={itemKey}>{inline(lines[i]!.content, itemKey)}</li>);
        i++;
      }
      blocks.push(
        kind === "ul" ? (
          <ul key={key} className="my-1 list-disc pl-5">
            {items}
          </ul>
        ) : (
          <ol key={key} className="my-1 list-decimal pl-5">
            {items}
          </ol>
        ),
      );
      continue;
    }

    // Paragraph: gather consecutive paragraph lines, joined with soft breaks.
    const key = nextKey();
    const para: ReactNode[] = [];
    let row = 0;
    while (i < lines.length && lines[i]!.kind === "paragraph") {
      if (row > 0) para.push(<br key={`${key}-br${row}`} />);
      para.push(...inline(lines[i]!.content, `${key}-${row}`));
      row++;
      i++;
    }
    blocks.push(
      <p key={key} className="my-1">
        {para}
      </p>,
    );
  }

  return blocks;
}
