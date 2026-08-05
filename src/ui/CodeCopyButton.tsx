import { useEffect, useRef, useState } from "react";

import { unlock } from "../achievements/index.ts";
import { useT } from "../i18n/index.ts";
import { writeClipboard } from "./clipboard.ts";
import { CheckIcon, CopyIcon } from "./icons.tsx";

// The copy button a fenced code block wears in its top-right corner, so the
// code can be lifted out with one tap — without placing the caret in the note,
// selecting the block by hand, or opening the raw source. One press puts the
// block's lines (fences excluded) on the clipboard; the glyph flips to a check
// for a moment to confirm the write.
//
// It is drawn *inside* the contenteditable surface, absolutely positioned over
// the block's first drawn line (see `codeBlockCopyAnchors`), which puts three
// constraints on it:
//
// - `contentEditable={false}` so the browser treats it as an atom rather than
//   as editable content of the note, and it never lands in the source.
// - the mousedown is cancelled, so pressing it doesn't roll the caret into the
//   block (which would unfold its ``` fences and shuffle the block down a line
//   under the user's finger mid-press) — the same trick a link in the preview
//   uses.
// - it is unselectable, so dragging a selection across the note doesn't sweep
//   the button up with the code.

export function CodeCopyButton({ code }: { code: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  async function copy() {
    const ok = await writeClipboard(code);
    if (!ok) return;
    unlock("snippetSnatcher");
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
  }

  const label = copied ? t("app.copy.copied") : t("app.copyCode");

  return (
    // A zero-height rail across the anchor line, with the button floated to its
    // right end. Two things are going on:
    //
    // - The rail is centred on the block's first *row* rather than on the
    //   anchor line's box: a code line is 20px tall (`text-sm`, a fixed rem
    //   line-height the app font scale doesn't touch) and the button is 24px,
    //   so `-2px` centres it on that row whether the line fits on one row or
    //   wraps onto several. On a one-line block the button then sits in the
    //   slab instead of hanging out of it, and on a tall one it lands in the
    //   corner — where GitHub puts it.
    // - The float is `sticky`, so with word wrap off (the note scrolls
    //   sideways and every line is as wide as the widest one in the note) the
    //   button is pulled back to the visible right edge instead of parking a
    //   screen or two off to the right where nobody would find it. With wrap
    //   on there is nothing to scroll, so it simply sits at the line's end.
    <div
      contentEditable={false}
      className="absolute inset-x-0 top-[-2px] z-10 h-0 select-none"
    >
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void copy()}
        title={label}
        aria-label={label}
        draggable={false}
        className={`sticky right-4 float-right mr-1 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[6px] border border-line bg-surface-3 transition-colors hover:border-muted/60 hover:bg-surface focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none ${
          copied ? "text-accent" : "text-muted hover:text-fg-bright"
        }`}
      >
        {copied ? (
          <CheckIcon className="h-3.5 w-3.5" />
        ) : (
          <CopyIcon className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}
