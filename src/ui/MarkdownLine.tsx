import { type ReactNode } from "react";

import {
  parseInline,
  type InlineNode,
  type LineBlock,
} from "../domain/markdown.ts";
import { lineTextClass } from "./markdown-line-class.ts";

// Presentational rendering for the live-preview editor: turns a parsed
// `LineBlock` into the formatted React it shows on every line the caret is
// *not* on. Leaf inline nodes carry their source-column `offset` through to a
// `data-src` attribute so the editor can map a click on rendered text back to
// a caret position in the raw source (see `MarkdownEditor.tsx`).

function renderInline(nodes: InlineNode[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return (
          <span key={i} data-src={node.offset}>
            {node.text}
          </span>
        );
      case "code":
        return (
          <code
            key={i}
            data-src={node.offset}
            className="rounded bg-surface-2 px-1 py-0.5 text-[0.9em] text-fg-bright"
          >
            {node.text}
          </code>
        );
      case "link":
        return (
          <a
            key={i}
            data-src={node.offset}
            href={node.href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-link underline underline-offset-2"
          >
            {node.text}
          </a>
        );
      case "strong":
        return (
          <strong key={i} className="font-bold text-fg-bright">
            {renderInline(node.children)}
          </strong>
        );
      case "em":
        return <em key={i}>{renderInline(node.children)}</em>;
      case "strikethrough":
        return (
          <s key={i} className="text-muted">
            {renderInline(node.children)}
          </s>
        );
    }
  });
}

// Inline content, falling back to a non-breaking space so an empty line keeps
// a full line-box (and stays clickable to place the caret there).
function inlineContent(block: LineBlock): ReactNode {
  if (block.content.length === 0) {
    return <span data-src={block.contentStart}>{" "}</span>;
  }
  return renderInline(parseInline(block.content, block.contentStart));
}

/** Render one source line as its formatted Markdown. */
export function RenderedLine({ block }: { block: LineBlock }) {
  const sizeClass = lineTextClass(block);

  switch (block.kind) {
    case "blank":
      return <div className="whitespace-pre-wrap">{" "}</div>;

    case "hr":
      return (
        <div className="flex items-center" data-src={block.contentStart}>
          <hr className="my-[0.6em] w-full border-t border-line" />
        </div>
      );

    case "heading":
      return <div className={sizeClass}>{inlineContent(block)}</div>;

    case "quote":
      return (
        <div className="border-l-2 border-line pl-3 text-muted italic">
          {inlineContent(block)}
        </div>
      );

    case "ul":
      return (
        <div className="flex gap-2">
          <span aria-hidden className="text-accent select-none">
            •
          </span>
          <span className="min-w-0 flex-1">{inlineContent(block)}</span>
        </div>
      );

    case "ol":
      return (
        <div className="flex gap-2">
          <span aria-hidden className="text-accent tabular-nums select-none">
            {block.ordinal}
          </span>
          <span className="min-w-0 flex-1">{inlineContent(block)}</span>
        </div>
      );

    case "fence":
    case "code":
      return (
        <div className={`${sizeClass} text-muted`} data-src={0}>
          {block.raw.length === 0 ? " " : block.raw}
        </div>
      );

    case "paragraph":
      return <div>{inlineContent(block)}</div>;
  }
}
