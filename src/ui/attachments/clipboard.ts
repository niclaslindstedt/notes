// Putting an image attachment on the *system* clipboard — the picture itself,
// not a link to it. This is what Copy and Cut do to a selected image, and what
// makes an image in a note paste into a chat window, a document, or another
// note (see `docs/overview.md#image-selection`).
//
// Two flavours go on the clipboard together, and both matter:
//
//   - **`image/png`** — the picture, for everything outside the app. PNG
//     because it is the one image type every browser's clipboard accepts; an
//     attachment stored as JPEG, WebP or AVIF is re-encoded through a canvas
//     on the way out rather than offered in a format the write would reject.
//   - **`text/plain`** — the attachment's own Markdown reference. Pasting back
//     into a note takes *this* flavour (see `MarkdownEditor`'s paste path), so
//     a cut-and-paste inside the app moves the existing file rather than
//     making a second copy of it, and the picture keeps its filename.
//
// The `ClipboardItem` is built **synchronously, from promises**, because Safari
// ties a clipboard write to the gesture that asked for it and an `await` before
// the write loses that tie. Where the image flavour can't be produced at all
// (an SVG a canvas won't rasterise, a browser with no `ClipboardItem`), the
// write falls back to the reference alone: outside the app that is a line of
// Markdown, but inside it, it still pastes the image.

import {
  type Attachment,
  attachmentMarkdown,
} from "../../domain/attachment.ts";
import { createLogger } from "../../dev/logger.ts";

const log = createLogger("attachments");

/**
 * Copy an image attachment to the system clipboard. `dataUrl` is its bytes as
 * the editor already holds them. Resolves false when nothing could be written
 * at all — the caller says so rather than pretending the copy took.
 */
export async function copyImageToClipboard(
  attachment: Attachment,
  dataUrl: string,
): Promise<boolean> {
  const markdown = attachmentMarkdown(attachment);
  try {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      throw new Error("clipboard writes unsupported");
    }
    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": pngBlob(dataUrl, attachment.mime),
        "text/plain": new Blob([markdown], { type: "text/plain" }),
      }),
    ]);
    return true;
  } catch (err) {
    log.warn(`copying ${attachment.filename} as an image failed`, err);
  }
  try {
    await navigator.clipboard.writeText(markdown);
    return true;
  } catch (err) {
    log.warn(`copying ${attachment.filename} failed`, err);
    return false;
  }
}

/** The attachment's bytes as a PNG blob, re-encoding when it isn't one. */
async function pngBlob(dataUrl: string, mime: string): Promise<Blob> {
  const blob = await (await fetch(dataUrl)).blob();
  if (mime === "image/png") return blob;
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  if (canvas.width === 0 || canvas.height === 0) {
    // An SVG with no intrinsic size draws nowhere; the reference fallback is
    // the honest answer rather than a blank rectangle on the clipboard.
    throw new Error("image has no intrinsic size");
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(image, 0, 0);
  const png = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!png) throw new Error("re-encoding to png failed");
  return png;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image decode failed"));
    image.src = src;
  });
}
