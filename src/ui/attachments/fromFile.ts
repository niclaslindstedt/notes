// Turn a pasted / dropped image into a note `Attachment`: read the blob as a
// `data:` URL, mint a unique filename from its type and name, and pre-warm its
// thumbnail so the inline preview paints immediately. DOM-bound (FileReader,
// DataTransfer, ClipboardEvent), so it lives in `ui/`.

import {
  type Attachment,
  attachmentFilename,
  isAttachableImageMime,
} from "../../domain/attachment.ts";
import { warmThumbnail } from "./thumbnail.ts";

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/** Build an `Attachment` from an image file, or null when it isn't an image. */
export async function fileToAttachment(file: File): Promise<Attachment | null> {
  if (!isAttachableImageMime(file.type)) return null;
  const data = await readAsDataUrl(file);
  const filename = attachmentFilename(file.type, file.name);
  warmThumbnail(filename, data);
  return { filename, mime: file.type, data };
}

/** The image files among a drop / paste's items (filtered by MIME type). */
export function imageFilesFrom(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const out: File[] = [];
  // `items` carries clipboard images that aren't in `files` on some browsers;
  // de-dupe by falling back to `files` only when `items` is empty.
  if (data.items && data.items.length > 0) {
    for (const item of Array.from(data.items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file && isAttachableImageMime(file.type)) out.push(file);
    }
    if (out.length > 0) return out;
  }
  for (const file of Array.from(data.files ?? [])) {
    if (isAttachableImageMime(file.type)) out.push(file);
  }
  return out;
}
