// "Does this attachment still exist?" — asked of the whole document, not of
// one note.
//
// A note's body can arrive holding a reference to an attachment the note has
// never heard of: an image was cut out of one note and pasted into another, or
// a line of Markdown carrying an `![…](attachments/…)` was copied across. The
// reference alone is not the picture — the *file* lives under the note that
// owns it — so before such a paste lands, the editor asks this lookup whether
// any note in the document declares that filename, and for its bytes if one
// does. Found, the attachment is re-attached to the note being pasted into and
// the picture appears; not found, the reference names something that is gone
// and the user is told so rather than being left with a broken thumbnail.
//
// The app provides it (it is the only layer holding both the document and the
// backend's fetcher); the editor consumes it. Absent — a surface rendering a
// note on its own — every cross-note reference simply reads as missing.

import { createContext, useContext } from "react";

import type { Attachment } from "../../domain/attachment.ts";

/**
 * Find an attachment by filename anywhere in the document, with its bytes.
 * Resolves null when no note declares it, or when its bytes can't be fetched —
 * an attachment that can't be read can't be re-attached, so for this question
 * the two are the same answer.
 */
export type AttachmentLookup = (filename: string) => Promise<Attachment | null>;

export const AttachmentLookupContext = createContext<AttachmentLookup | null>(
  null,
);

export function useAttachmentLookup(): AttachmentLookup | null {
  return useContext(AttachmentLookupContext);
}
