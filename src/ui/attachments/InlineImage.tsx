import { type MouseEvent as ReactMouseEvent } from "react";

import { type Attachment } from "../../domain/attachment.ts";
import { useAttachmentsContext } from "./context.ts";
import { useAttachmentData } from "./fetch-context.ts";
import { useThumbnail } from "./thumbnail.ts";

// The inline preview of an attached image inside the live-preview editor (and
// the read-only note view): a small, downscaled thumbnail that opens the
// original full-size on click. Rendered in place of an `![alt](attachments/…)`
// image node once the reference resolves to one of the note's attachments. The
// bytes are fetched on demand the first time the image renders (a note loads
// without them), so a placeholder shows until they arrive.

type Props = {
  attachment: Attachment;
  /** Source column of the markdown node, for the editor's click-to-caret map. */
  srcOffset: number;
  onOpen: (attachment: Attachment) => void;
};

export function InlineImage({ attachment, srcOffset, onOpen }: Props) {
  const note = useAttachmentsContext()?.note ?? null;
  const data = useAttachmentData(note, attachment);
  const thumb = useThumbnail(attachment.filename, data);
  const src = thumb ?? data;
  return (
    <button
      type="button"
      data-src={srcOffset}
      // Stop the editor's line-level mousedown from rolling the caret here, so
      // a click opens the image instead of just repositioning the cursor.
      onMouseDown={(e: ReactMouseEvent) => e.stopPropagation()}
      onClick={(e: ReactMouseEvent) => {
        e.stopPropagation();
        onOpen(attachment);
      }}
      title={attachment.filename}
      className="my-1 inline-block max-w-full cursor-zoom-in overflow-hidden rounded-[var(--radius)] border border-line bg-surface-2 align-top transition hover:border-accent focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
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
