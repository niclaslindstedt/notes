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
import type { Note } from "../../domain/note.ts";

export type AttachmentsContextValue = {
  /** The note attachment a body reference points at, or null. */
  resolve: (href: string) => Attachment | null;
  /** Open an image attachment full-size in the viewer overlay. */
  open: (attachment: Attachment) => void;
  /**
   * The filename of the image the note currently has *selected*, or null. A
   * selected image is the one Copy, Cut and Delete act on — the picture's
   * answer to a text selection (see `docs/overview.md#image-selection`). Only
   * ever set where `editable` is true.
   */
  selected: string | null;
  /** Select an image (or clear the selection with null). */
  select: (filename: string | null) => void;
  /**
   * Whether the surface showing these attachments can change the note. False
   * in the read-only archive view and in a locked note, where an image has no
   * Cut or Delete to offer — and so nothing to be selected *for*, which is why
   * a plain click there opens the picture as it always did.
   */
  editable: boolean;
  /** Open the image's action menu at a point in the viewport (right-click,
   *  long press). */
  openMenu: (attachment: Attachment, at: { x: number; y: number }) => void;
  /** Copy an image to the system clipboard. Resolves false if nothing could
   *  be written at all. */
  copy: (attachment: Attachment) => Promise<boolean>;
  /** The note's attachments, for the collected end-of-note block. */
  attachments: readonly Attachment[];
  /** Whether images / files render inline or collected at the note's foot. */
  placement: AttachmentPlacement;
  /** The note these attachments belong to, for fetching bytes on demand. */
  note: Note | null;
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
