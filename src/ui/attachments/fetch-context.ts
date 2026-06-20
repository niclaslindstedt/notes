// On-demand attachment bytes. A note loaded from a file/cloud backend carries
// its attachments' metadata (filename + mime) but no bytes; the bytes are
// fetched the first time the note is opened and an image/file actually renders.
// This context carries the storage-backed fetcher down to the leaf components
// (InlineImage, ImageViewer, FileAttachment) without prop-threading, and a
// small module cache keyed by the (unique) filename means a given attachment is
// fetched at most once per session.

import { createContext, useContext, useEffect, useState } from "react";

import type { Attachment } from "../../domain/attachment.ts";
import type { Note } from "../../domain/note.ts";

/** Fetch one attachment's bytes as a `data:` URL, or null when unavailable. */
export type AttachmentFetcher = (
  note: Note,
  filename: string,
) => Promise<string | null>;

export const AttachmentFetchContext = createContext<AttachmentFetcher | null>(
  null,
);

export function useAttachmentFetcher(): AttachmentFetcher | null {
  return useContext(AttachmentFetchContext);
}

// Fetched `data:` URLs keyed by the attachment's stable, unique filename.
const cache = new Map<string, string>();

/**
 * Resolve an attachment's `data:` URL: returns its inline `data` immediately
 * when present (a freshly pasted attachment, or the browser backend), otherwise
 * fetches the bytes on demand and returns null until they arrive. `note` is the
 * note the attachment belongs to (needed to locate its blob); a null `note` or
 * fetcher means "no fetch" — the inline `data`, if any, is all there is.
 */
export function useAttachmentData(
  note: Note | null | undefined,
  attachment: Attachment,
): string | null {
  const fetcher = useAttachmentFetcher();
  const initial = attachment.data ?? cache.get(attachment.filename) ?? null;
  const [data, setData] = useState<string | null>(initial);

  useEffect(() => {
    if (attachment.data) {
      setData(attachment.data);
      return;
    }
    const hit = cache.get(attachment.filename);
    if (hit) {
      setData(hit);
      return;
    }
    if (!note || !fetcher) return;
    let cancelled = false;
    void fetcher(note, attachment.filename).then((url) => {
      if (url) cache.set(attachment.filename, url);
      if (!cancelled) setData(url);
    });
    return () => {
      cancelled = true;
    };
  }, [note, fetcher, attachment.filename, attachment.data]);

  return data;
}
