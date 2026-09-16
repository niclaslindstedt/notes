import { type MouseEvent as ReactMouseEvent, useRef } from "react";

import { useDesktopPointer } from "@niclaslindstedt/oss-framework/hooks";

import { type Attachment } from "../../domain/attachment.ts";
import { useAttachmentsContext } from "./context.ts";
import { useAttachmentData } from "./fetch-context.ts";
import { useThumbnail } from "./thumbnail.ts";
import { useLongPress } from "../hooks/useLongPress.ts";

// The inline preview of an attached image inside the live-preview editor (and
// the read-only note view): a small, downscaled thumbnail that opens the
// original full-size on click. Rendered in place of an `![alt](attachments/…)`
// image node once the reference resolves to one of the note's attachments. The
// bytes are fetched on demand the first time the image renders (a note loads
// without them), so a placeholder shows until they arrive.
//
// **Where the note can be edited, the first click selects rather than opens.**
// A picture in a note is a thing you act on — copy it, cut it, delete it — and
// none of that has anywhere to hang without a selection, so a click picks the
// picture out (the ring) and a click on the already-selected picture opens it
// full-size. Read-only surfaces have nothing to select *for*, so there a click
// opens as it always did. Right-click, or a hold on a touchscreen, brings the
// same actions up as a menu (see `AttachmentsProvider`).

type Props = {
  attachment: Attachment;
  /** Source column of the markdown node, for the editor's click-to-caret map. */
  srcOffset: number;
  onOpen: (attachment: Attachment) => void;
};

export function InlineImage({ attachment, srcOffset, onOpen }: Props) {
  const ctx = useAttachmentsContext();
  const note = ctx?.note ?? null;
  const data = useAttachmentData(note, attachment);
  const thumb = useThumbnail(attachment.filename, data);
  const src = thumb ?? data;
  const selectable = ctx?.editable ?? false;
  const selected = ctx?.selected === attachment.filename;
  const anchor = useRef<HTMLButtonElement | null>(null);
  // A hold is the touchscreen's right-click. On a computer there already is a
  // right-click, and a mouse button held down over a picture for half a second
  // is a slow click, not a request for a menu.
  const desktop = useDesktopPointer();

  const press = useLongPress({
    onPress: () => {
      // Selectable and not yet picked out: the click takes the picture. Every
      // other case opens it — a second click on the selected one, and every
      // click on a surface that can't change the note.
      if (selectable && !selected) ctx?.select(attachment.filename);
      else onOpen(attachment);
    },
    onLongPress:
      ctx && !desktop
        ? () => {
            // A hold has no useful pointer position left by the time it fires
            // — the finger has been still for half a second and is covering
            // the picture — so the menu opens over the thumbnail's middle.
            const rect = anchor.current?.getBoundingClientRect();
            ctx.openMenu(attachment, {
              x: (rect?.left ?? 0) + (rect?.width ?? 0) / 2,
              y: (rect?.top ?? 0) + (rect?.height ?? 0) / 2,
            });
          }
        : undefined,
  });

  return (
    <button
      type="button"
      ref={anchor}
      data-src={srcOffset}
      data-attachment-image={attachment.filename}
      aria-pressed={selectable ? selected : undefined}
      // Stop the editor's line-level mousedown from rolling the caret here, so
      // a click acts on the image instead of just repositioning the cursor.
      onMouseDown={(e: ReactMouseEvent<HTMLElement>) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.stopPropagation();
        press.onPointerDown(e);
      }}
      onPointerMove={press.onPointerMove}
      onPointerUp={press.onPointerUp}
      onPointerCancel={press.onPointerCancel}
      onPointerLeave={press.onPointerLeave}
      onClick={(e: ReactMouseEvent<HTMLElement>) => {
        e.stopPropagation();
        press.onClick();
      }}
      onContextMenu={(e: ReactMouseEvent<HTMLElement>) => {
        if (!ctx) return;
        e.preventDefault();
        e.stopPropagation();
        ctx.openMenu(attachment, { x: e.clientX, y: e.clientY });
      }}
      title={attachment.filename}
      className={`my-1 inline-block max-w-full overflow-hidden rounded-[var(--radius)] border bg-surface-2 align-top transition focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none ${
        selected
          ? "cursor-pointer border-accent ring-2 ring-accent"
          : "cursor-zoom-in border-line hover:border-accent"
      }`}
    >
      {src ? (
        <img
          src={src}
          alt={attachment.filename}
          className="block max-h-40 w-auto max-w-full object-contain"
          draggable={false}
        />
      ) : (
        // Bytes not loaded yet — a small skeleton box keeps the layout stable.
        <span className="block h-24 w-32 animate-pulse bg-surface-3" />
      )}
    </button>
  );
}
