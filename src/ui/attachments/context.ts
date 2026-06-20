// React context that lets a rendered Markdown image line resolve an
// `attachments/<file>` reference to the note's in-memory attachment (and open
// it full-size) without threading props through every inline-render call. The
// live-preview editor and the read-only note view each provide it scoped to
// the note they're showing; `MarkdownLine` consumes it when it meets an image
// node. Absent provider (a context with no attachments) renders the image's
// alt text as plain markdown instead.

import { createContext, useContext } from "react";

import {
  type Attachment,
  type AttachmentPlacement,
  attachmentFilenameFromHref,
} from "../../domain/attachment.ts";

export type AttachmentsContextValue = {
  /** The note attachment a body reference points at, or null. */
  resolve: (href: string) => Attachment | null;
  /** Open an image attachment full-size in the viewer overlay. */
  open: (attachment: Attachment) => void;
  /** The note's attachments, for the collected end-of-note block. */
  attachments: readonly Attachment[];
  /** Whether images / files render inline or collected at the note's foot. */
  placement: AttachmentPlacement;
};

export const AttachmentsContext = createContext<AttachmentsContextValue | null>(
  null,
);

export function useAttachmentsContext(): AttachmentsContextValue | null {
  return useContext(AttachmentsContext);
}

/** Find the attachment a body image-reference resolves to, by its filename. */
export function resolveAttachment(
  href: string,
  attachments: readonly Attachment[] | undefined,
): Attachment | null {
  if (!attachments || attachments.length === 0) return null;
  const filename = attachmentFilenameFromHref(href);
  if (!filename) return null;
  return attachments.find((a) => a.filename === filename) ?? null;
}
