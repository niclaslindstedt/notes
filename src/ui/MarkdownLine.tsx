import { memo, type ReactNode } from "react";

import { attachmentFilenameFromHref } from "../domain/attachment.ts";
import {
  parseInline,
  shortenUrl,
  type InlineNode,
  type LineBlock,
} from "../domain/markdown.ts";
import { FileAttachment } from "./attachments/FileAttachment.tsx";
import { InlineImage } from "./attachments/InlineImage.tsx";
import { useAttachmentsContext } from "./attachments/context.ts";
import { lineTextClass } from "./markdown-line-class.ts";

// Presentational rendering for the live-preview editor: turns a parsed
// `LineBlock` into the formatted React it shows on every line the caret is
// *not* on. Leaf inline nodes carry their source-column `offset` through to a
// `data-src` attribute so the editor can map a click on rendered text back to
// a caret position in the raw source (see `MarkdownEditor.tsx`).

// The bullet glyph for an unordered item, rotating by nesting depth: parent →
// sub → sub-sub, then repeat. All three glyphs are present in the app's
// bundled monospace font, so they render and stay centred identically on every
// platform (unlike the `◦` / `▪` this used to cycle through, which the font
// lacks — those got substituted per-device and sat off-centre).
const BULLET_GLYPHS = ["•", "-", "+"];
function bulletGlyph(depth = 0): string {
  return BULLET_GLYPHS[depth % BULLET_GLYPHS.length]!;
}

// Left-indent for a nested list item — one step per nesting level. `undefined`
// at the top level so the row keeps its natural margin.
function indentStyle(depth = 0): { marginLeft: string } | undefined {
  return depth > 0 ? { marginLeft: `${depth * 1.25}em` } : undefined;
}

function renderInline(
  nodes: InlineNode[],
  shortenLinkChars: number,
): ReactNode[] {
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
          <LinkNode
            key={i}
            text={node.text}
            href={node.href}
            offset={node.offset}
            bare={node.bare === true}
            // A bare URL may be trimmed for display; an explicit link's label
            // is the user's own text and is always shown verbatim.
            display={node.bare ? shortenUrl(node.text, shortenLinkChars) : null}
          />
        );
      case "image":
        return (
          <ImageNode
            key={i}
            alt={node.alt}
            href={node.href}
            offset={node.offset}
          />
        );
      case "strong":
        return (
          <strong key={i} className="font-bold text-fg-bright">
            {renderInline(node.children, shortenLinkChars)}
          </strong>
        );
      case "em":
        return <em key={i}>{renderInline(node.children, shortenLinkChars)}</em>;
      case "strikethrough":
        return (
          <s key={i} className="text-muted">
            {renderInline(node.children, shortenLinkChars)}
          </s>
        );
    }
  });
}

// An image reference. When it resolves to one of the note's attachments (via
// the surrounding `AttachmentsProvider`), render the clickable thumbnail;
// otherwise fall back to the raw markdown text so a stray `![…](…)` stays
// visible and editable rather than vanishing. When the placement puts images
// at the end of the note, the inline node renders nothing — the thumbnail is
// shown in the collected end-of-note block instead (`AttachmentsEndBlock`).
function ImageNode({
  alt,
  href,
  offset,
}: {
  alt: string;
  href: string;
  offset: number;
}) {
  const ctx = useAttachmentsContext();
  const attachment = ctx?.resolve(href) ?? null;
  if (!ctx || !attachment) {
    return <span data-src={offset}>{`![${alt}](${href})`}</span>;
  }
  if (ctx.placement.imagesAtEnd) return null;
  return (
    <InlineImage attachment={attachment} srcOffset={offset} onOpen={ctx.open} />
  );
}

// A link node. A link whose href points into the `attachments/` tree is a file
// attachment: render the downloadable file chip when it resolves (or the raw
// `[…](…)` markdown when it doesn't, so an unresolved reference stays editable
// rather than rendering as a broken relative link), and nothing when the
// placement collects files at the note's end. Any other link is an ordinary
// hyperlink. Stops the editor's line-level mousedown so a click follows the
// link / downloads the file instead of rolling the caret onto its line.
function LinkNode({
  text,
  href,
  offset,
  bare,
  display,
}: {
  text: string;
  href: string;
  offset: number;
  // Whether this is a bare autolinked URL (its rendered text is the source) as
  // opposed to an explicit `[label](url)` whose rendered text is the label.
  bare: boolean;
  // The text to render in place of `text` — a shortened bare URL, or null to
  // show the source verbatim. The href and `data-src` keep the full URL.
  display: string | null;
}) {
  const ctx = useAttachmentsContext();
  if (attachmentFilenameFromHref(href) !== null) {
    const attachment = ctx?.resolve(href) ?? null;
    if (ctx && attachment) {
      if (ctx.placement.filesAtEnd) return null;
      return <FileAttachment attachment={attachment} srcOffset={offset} />;
    }
    return <span data-src={offset}>{`[${text}](${href})`}</span>;
  }
  return (
    <a
      data-src={offset}
      // A bare URL's display may be shortened, so its source length differs from
      // the rendered text — `data-len` lets a selection map the end of the link
      // back to the end of the full URL in the source (see `markdown-selection`).
      data-len={bare ? text.length : undefined}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      // Links are draggable by default, which would start a link drag-and-drop
      // instead of a text selection when the user drags across the note.
      draggable={false}
      // Inside the contenteditable surface a plain click would drop the caret
      // (turning the link's line into raw source) and the browser won't navigate
      // an editable anchor. Suppress the caret on press and open the link on a
      // plain, unmodified click instead — to edit it, click just past and
      // backspace in. A modified click (new tab / download shortcuts) or a
      // drag-select is left to the browser.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) return; // a drag-select ending here
        e.preventDefault();
        window.open(href, "_blank", "noreferrer,noopener");
      }}
      className="text-link underline underline-offset-2"
    >
      {display ?? text}
    </a>
  );
}

// Inline content, falling back to a non-breaking space so an empty line keeps
// a full line-box (and stays clickable to place the caret there).
function inlineContent(block: LineBlock, shortenLinkChars: number): ReactNode {
  if (block.content.length === 0) {
    return <span data-src={block.contentStart}>{" "}</span>;
  }
  return renderInline(
    parseInline(block.content, block.contentStart),
    shortenLinkChars,
  );
}

/** Render one source line as its formatted Markdown. */
function RenderedLineImpl({
  block,
  shortenLinkChars = 0,
}: {
  block: LineBlock;
  /** Trim bare URLs to this many characters either side (0 = show in full). */
  shortenLinkChars?: number;
}) {
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
      return (
        <div className={sizeClass}>
          {inlineContent(block, shortenLinkChars)}
        </div>
      );

    case "quote":
      return (
        <div className="border-l-2 border-line pl-3 text-muted italic">
          {inlineContent(block, shortenLinkChars)}
        </div>
      );

    case "ul":
      return (
        <div className="flex gap-2" style={indentStyle(block.depth)}>
          {/* A fixed-width marker box exactly one text line tall, with the
              glyph centred in both axes: every level's text starts at the same
              column, and the marker sits on the first text line's centre. The
              `1lh` height must live on this span (which keeps the text's line
              height) — `leading-none` belongs on the inner glyph only, or it
              would collapse `1lh` to 1em and the marker would ride high. Every
              glyph lives in the app font, so this centres identically on every
              platform without per-glyph tuning. */}
          <span
            aria-hidden
            className="flex h-[1lh] w-[1.25em] items-center justify-center text-accent select-none"
          >
            <span className="text-[1.15em] leading-none">
              {bulletGlyph(block.depth)}
            </span>
          </span>
          <span className="min-w-0 flex-1">
            {inlineContent(block, shortenLinkChars)}
          </span>
        </div>
      );

    case "ol":
      return (
        <div className="flex gap-2" style={indentStyle(block.depth)}>
          <span aria-hidden className="text-accent tabular-nums select-none">
            {block.marker ?? block.ordinal}
          </span>
          <span className="min-w-0 flex-1">
            {inlineContent(block, shortenLinkChars)}
          </span>
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
      return <div>{inlineContent(block, shortenLinkChars)}</div>;
  }
}

// The live editor re-derives `classifyLines(body)` on *every keystroke*, handing
// each rendered line a brand-new `LineBlock` object — so reference equality never
// holds and an un-memoized line would re-run `parseInline` and rebuild its whole
// subtree on every character, for every line in the note. Only the caret's line
// actually changes per keystroke (and it renders as a raw textarea, not here), so
// comparing the block's primitive fields lets every untouched line bail out of the
// re-render: the per-keystroke cost drops from O(lines) to O(1). Attachment changes
// still flow in through `useAttachmentsContext` (memo doesn't block context).
export const RenderedLine = memo(
  RenderedLineImpl,
  (a, b) =>
    a.shortenLinkChars === b.shortenLinkChars &&
    a.block.kind === b.block.kind &&
    a.block.raw === b.block.raw &&
    a.block.content === b.block.content &&
    a.block.contentStart === b.block.contentStart &&
    a.block.level === b.block.level &&
    a.block.ordinal === b.block.ordinal &&
    a.block.depth === b.block.depth &&
    a.block.marker === b.block.marker,
);
