import type { LineBlock } from "../domain/markdown.ts";

// Font size / weight for a Markdown line's text, keyed off its block kind.
// Shared between the rendered line (`MarkdownLine.tsx`) and the live editor's
// active textarea (`MarkdownEditor.tsx`) so switching the caret onto a line
// keeps it the same height — the source line replaces the rendered one in
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
  if (block.kind === "code" || block.kind === "fence") {
    return "text-sm";
  }
  return "";
}
