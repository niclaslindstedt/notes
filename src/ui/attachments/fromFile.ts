// Turn a pasted / dropped file into a note `Attachment`: read the blob as a
// `data:` URL and mint a unique filename. An image also pre-warms its
// thumbnail so the inline preview paints immediately; any other file becomes a
// downloadable attachment with no preview. DOM-bound (FileReader, DataTransfer,
// ClipboardEvent), so it lives in `ui/`.

import {
  type Attachment,
  attachmentFilename,
  fileAttachmentFilename,
  isAttachableImageMime,
  mimeForFilename,
} from "../../domain/attachment.ts";
import { isImportableFilename } from "../../domain/import.ts";
import { warmThumbnail } from "./thumbnail.ts";

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Build an `Attachment` from any file. Images keep a MIME-derived extension
 * and pre-warm a thumbnail; other files keep their own extension (their MIME
 * may be unknown) and carry no preview.
 */
export async function fileToAttachment(file: File): Promise<Attachment | null> {
  const data = await readAsDataUrl(file);
  if (isAttachableImageMime(file.type)) {
    const filename = attachmentFilename(file.type, file.name);
    warmThumbnail(filename, data);
    return { filename, mime: file.type, data };
  }
  const filename = fileAttachmentFilename(file.name);
  const mime = file.type || mimeForFilename(file.name);
  return { filename, mime, data };
}

/** Every file in a drop / paste payload (deduping `items` against `files`). */
function filesFrom(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const out: File[] = [];
  // `items` carries clipboard files that aren't in `files` on some browsers;
  // de-dupe by falling back to `files` only when `items` is empty.
  if (data.items && data.items.length > 0) {
    for (const item of Array.from(data.items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file) out.push(file);
    }
    if (out.length > 0) return out;
  }
  return Array.from(data.files ?? []);
}

/**
 * The files in a drop / paste the editor should attach: images, plus any file
 * that isn't an importable markdown/text note. Importable text files are left
 * out so dropping a `.md` onto the editor still falls through to the
 * note-import path rather than attaching the note as a file.
 */
export function attachableFilesFrom(
  data: DataTransfer | null | undefined,
): File[] {
  return filesFrom(data).filter(
    (f) => isAttachableImageMime(f.type) || !isImportableFilename(f.name),
  );
}
