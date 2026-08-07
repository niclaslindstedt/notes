import type { CodeBlockEdges, LineBlock, RawMark } from "../domain/markdown.ts";

// Font size / weight for a Markdown line's text, keyed off its block kind.
// Shared between the rendered line (`MarkdownLine.tsx`) and the live editor's
// active raw line (`MarkdownEditor.tsx`) so switching the caret onto a line
// keeps it the same height — the raw source line replaces the rendered one in
// place without a reflow. Kept in its own module (no component exports) so
// fast-refresh stays happy.
export function lineTextClass(block: LineBlock): string {
  if (block.kind === "heading") {
    switch (block.level) {
      case 1:
        return "text-2xl font-bold text-fg-bright";
      case 2:
        return "text-xl font-bold text-fg-bright";
      case 3:
        return "text-lg font-semibold text-fg-bright";
      default:
        return "text-base font-semibold text-fg-bright";
    }
  }
  // A code line carries the block's slab of background itself: the lines of a
  // fenced block are separate stacked elements (the editor renders one per
  // source line), so there is no container to paint. Adjacent lines' boxes
  // meet, reading as one block — which is what keeps a block recognisable once
  // its ``` fences are hidden. The active raw line gets it too, so putting the
  // caret inside a block doesn't punch a hole in it.
  if (block.kind === "code" || block.kind === "fence") {
    return "bg-surface-2 px-2 text-sm";
  }
  return "";
}

// The classes one run of the active line's **raw source** wears
// (`rawLineSegments`), so `**bold**` reads bold with its asterisks still on
// screen. Only the marks that don't move text are honoured — weight, slant,
// decoration, colour — because the run sits in the line the caret is in, and a
// size or padding change would shift every column after it as the caret walks
// through.
export function rawMarkClass(marks: readonly RawMark[]): string {
  if (marks.length === 0) return "";
  const has = (m: RawMark) => marks.includes(m);
  const classes: string[] = [];
  if (has("strong")) classes.push("font-bold");
  if (has("em")) classes.push("italic");
  if (has("strikethrough")) classes.push("line-through");
  if (has("code")) classes.push("rounded bg-surface-2");
  if (has("link")) classes.push("underline underline-offset-2");
  // Exactly one colour: two `text-*` utilities on one element are resolved by
  // stylesheet order, not by the order they're listed here, so which one won
  // would be arbitrary. Pick the winner explicitly.
  const colour = has("link")
    ? "text-link"
    : has("code") || has("strong")
      ? "text-fg-bright"
      : has("strikethrough")
        ? "text-muted"
        : "";
  if (colour !== "") classes.push(colour);
  // Markup steps back by fading rather than by taking a colour of its own, so
  // it keeps the run's own colour (a dimmed `**` on bold text still reads as
  // that text's markup) and stays legible enough to aim a caret at.
  if (has("markup")) classes.push("opacity-60");
  return classes.join(" ");
}

// The rounded corners and vertical padding a code block's outermost drawn
// lines carry. The slab is stacked line backgrounds rather than one container
// (see `lineTextClass`), so the block's top line rounds and pads its top edge
// and its bottom line the bottom — a one-line block is both and closes the box
// on its own. The padding is what gives the block's first row room to hold the
// copy button, and what stops the code sitting flush against the slab's edge;
// interior lines stay tight, so a tall block doesn't turn airy. Shared with the
// active raw line, like `lineTextClass`, so the caret landing on an edge line
// doesn't change the block's height.
export function codeBlockEdgeClass(
  edges: CodeBlockEdges,
  index: number,
): string {
  const classes: string[] = [];
  if (edges.top.has(index)) classes.push("rounded-t-[var(--radius)] pt-2");
  if (edges.bottom.has(index)) classes.push("rounded-b-[var(--radius)] pb-2");
  return classes.join(" ");
}
