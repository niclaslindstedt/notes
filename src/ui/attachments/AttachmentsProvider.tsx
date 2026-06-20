import { type ReactNode, useMemo, useState } from "react";

import { type Attachment } from "../../domain/attachment.ts";
import { AttachmentsContext, resolveAttachment } from "./context.ts";
import { ImageViewer } from "./ImageViewer.tsx";

// Scopes attachment resolution + the full-size viewer to one note's images.
// Both the live-preview editor and the read-only note view wrap their rendered
// Markdown in this, so any `![alt](attachments/<file>)` line inside renders as
// a clickable thumbnail that opens the original. Owns the viewer overlay's
// open/close state — tracked as an index into the note's attachments so the
// viewer can step left/right through the whole set, not just the one clicked.

type Props = {
  attachments: readonly Attachment[] | undefined;
  children: ReactNode;
};

export function AttachmentsProvider({ attachments, children }: Props) {
  const list = useMemo(() => attachments ?? [], [attachments]);
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);
  const value = useMemo(
    () => ({
      resolve: (href: string) => resolveAttachment(href, list),
      open: (attachment: Attachment) => {
        const i = list.findIndex((a) => a.filename === attachment.filename);
        setViewingIndex(i >= 0 ? i : null);
      },
    }),
    [list],
  );
  const viewing = viewingIndex !== null ? list[viewingIndex] : undefined;
  return (
    <AttachmentsContext.Provider value={value}>
      {children}
      {viewingIndex !== null && viewing && (
        <ImageViewer
          attachments={list}
          index={viewingIndex}
          onIndexChange={setViewingIndex}
          onClose={() => setViewingIndex(null)}
        />
      )}
    </AttachmentsContext.Provider>
  );
}
