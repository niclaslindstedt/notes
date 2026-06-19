import { type ReactNode, useMemo, useState } from "react";

import { type Attachment } from "../../domain/attachment.ts";
import { AttachmentsContext, resolveAttachment } from "./context.ts";
import { ImageViewer } from "./ImageViewer.tsx";

// Scopes attachment resolution + the full-size viewer to one note's images.
// Both the live-preview editor and the read-only note view wrap their rendered
// Markdown in this, so any `![alt](attachments/<file>)` line inside renders as
// a clickable thumbnail that opens the original. Owns the viewer overlay's
// open/close state so a click anywhere in the subtree can surface it.

type Props = {
  attachments: readonly Attachment[] | undefined;
  children: ReactNode;
};

export function AttachmentsProvider({ attachments, children }: Props) {
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const value = useMemo(
    () => ({
      resolve: (href: string) => resolveAttachment(href, attachments),
      open: (attachment: Attachment) => setViewing(attachment),
    }),
    [attachments],
  );
  return (
    <AttachmentsContext.Provider value={value}>
      {children}
      {viewing && (
        <ImageViewer attachment={viewing} onClose={() => setViewing(null)} />
      )}
    </AttachmentsContext.Provider>
  );
}
