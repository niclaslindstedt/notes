import { type ReactNode, useMemo, useState } from "react";

import {
  type Attachment,
  type AttachmentPlacement,
  INLINE_PLACEMENT,
  isImageAttachment,
} from "../../domain/attachment.ts";
import { AttachmentsContext, resolveAttachment } from "./context.ts";
import { ImageViewer } from "./ImageViewer.tsx";

// Scopes attachment resolution + the full-size viewer to one note's
// attachments. Both the live-preview editor and the read-only note view wrap
// their rendered Markdown in this, so an `![alt](attachments/<file>)` image
// renders as a clickable thumbnail that opens the original and a
// `[file](attachments/<file>)` link renders as a downloadable file chip. Owns
// the viewer overlay's open/close state — tracked as an index into the note's
// *images* (the viewer is an image gallery; file attachments don't open in
// it) so it can step left/right through them, not just the one clicked.

type Props = {
  attachments: readonly Attachment[] | undefined;
  /** Where images / files render — inline (default) or at the note's foot. */
  placement?: AttachmentPlacement;
  children: ReactNode;
};

export function AttachmentsProvider({
  attachments,
  placement = INLINE_PLACEMENT,
  children,
}: Props) {
  const list = useMemo(() => attachments ?? [], [attachments]);
  // The viewer is an image gallery, so it steps through the images only.
  const images = useMemo(() => list.filter(isImageAttachment), [list]);
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);
  const value = useMemo(
    () => ({
      resolve: (href: string) => resolveAttachment(href, list),
      open: (attachment: Attachment) => {
        const i = images.findIndex((a) => a.filename === attachment.filename);
        setViewingIndex(i >= 0 ? i : null);
      },
      attachments: list,
      placement,
    }),
    [list, images, placement],
  );
  const viewing = viewingIndex !== null ? images[viewingIndex] : undefined;
  return (
    <AttachmentsContext.Provider value={value}>
      {children}
      {viewingIndex !== null && viewing && (
        <ImageViewer
          attachments={images}
          index={viewingIndex}
          onIndexChange={setViewingIndex}
          onClose={() => setViewingIndex(null)}
        />
      )}
    </AttachmentsContext.Provider>
  );
}
