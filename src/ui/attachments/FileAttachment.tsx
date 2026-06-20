import { type MouseEvent as ReactMouseEvent } from "react";

import { type Attachment } from "../../domain/attachment.ts";
import { useAttachmentsContext } from "./context.ts";
import { useAttachmentData } from "./fetch-context.ts";
import { FileTypeIcon } from "./file-icons.tsx";

// The inline representation of a non-image file attachment: a compact chip
// carrying the file's type icon and its name. Unlike an image (which previews
// as a thumbnail and opens in the viewer) a file has no preview — clicking the
// chip downloads it. Rendered in place of a `[file](attachments/…)` link node
// once the reference resolves to one of the note's attachments, and reused in
// the collected end-of-note block when file attachments are placed there.

type Props = {
  attachment: Attachment;
  /** Source column of the markdown node, for the editor's click-to-caret map. */
  srcOffset: number;
};

export function FileAttachment({ attachment, srcOffset }: Props) {
  const note = useAttachmentsContext()?.note ?? null;
  // Fetch the bytes on demand so the chip's download link works even though the
  // note loaded without them. Until they arrive the link is inert.
  const data = useAttachmentData(note, attachment);
  return (
    <a
      href={data ?? undefined}
      download={attachment.filename}
      data-src={srcOffset}
      aria-disabled={data ? undefined : true}
      // Stop the editor's line-level mousedown from rolling the caret here, so
      // a click downloads the file instead of entering edit mode (mirrors the
      // inline image and link nodes).
      onMouseDown={(e: ReactMouseEvent) => e.stopPropagation()}
      onClick={(e: ReactMouseEvent) => {
        e.stopPropagation();
        if (!data) e.preventDefault();
      }}
      title={attachment.filename}
      className="my-1 inline-flex max-w-full cursor-pointer items-center gap-2 overflow-hidden rounded-[var(--radius)] border border-line bg-surface-2 px-2.5 py-1.5 align-top text-sm text-fg no-underline transition hover:border-accent focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
    >
      <FileTypeIcon
        filename={attachment.filename}
        className="h-5 w-5 shrink-0 text-muted"
      />
      <span className="truncate">{attachment.filename}</span>
    </a>
  );
}
