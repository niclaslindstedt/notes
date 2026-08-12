// The three things the export menu does with the open note: write it to a
// `.md` file, write it to a PDF, and put it on the clipboard. Each is a plain
// async function so the button component stays presentational.
//
// The pure parts live elsewhere: `buildCopyText` (`src/ui/copy-note.ts`) builds
// the clipboard/Markdown text, `layoutPdf` (`src/domain/pdf-layout.ts`)
// paginates the note, and `buildPdf` (`./pdf-document.ts`) writes the file.
// What's here is the glue: filenames, the download anchor, and resolving a
// note's image attachments to bytes the PDF can carry.

import {
  attachmentFilenameFromHref,
  isImageAttachment,
  type Attachment,
} from "../../domain/attachment.ts";
import type { PdfSettings } from "../../domain/pdf.ts";
import type { CompiledTransform } from "../../domain/transform.ts";
import type { Note } from "../../domain/note.ts";
import { noteToMarkdown } from "../../storage/markdown/codec.ts";
import type { AttachmentFetcher } from "../attachments/fetch-context.ts";
import type { LoadedImage } from "./pdf-document.ts";

/**
 * The filename an exported note is offered under: a slug of its title, or
 * `note` for an untitled one. Deliberately *not* the file backends'
 * `noteFileStem` — that suffixes a slice of the note id so two same-titled
 * notes can share a directory, which is exactly the noise you don't want in a
 * file you're about to email someone.
 */
export function exportFileStem(note: Note): string {
  const slug = note.title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "note";
}

/**
 * Download the open note as a `.md` file. The bytes are the ones the file /
 * cloud backends store (`noteToMarkdown`), YAML front matter and all, so an
 * exported note dropped into a synced folder — or into another Markdown app —
 * round-trips rather than arriving stripped of its metadata.
 */
export function downloadMarkdown(note: Note): void {
  download(
    new Blob([noteToMarkdown(note)], { type: "text/markdown;charset=utf-8" }),
    `${exportFileStem(note)}.md`,
  );
}

/** Offer a blob as a file the browser saves. */
function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    // Firefox only follows a click on an anchor that is in the document.
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Held one turn: revoking synchronously races the download in WebKit.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/**
 * Write the open note to a PDF with the user's export settings and save it.
 *
 * The file is built in the page rather than through the print dialog, which is
 * what keeps the URL and the date off the foot of every sheet and turns the
 * export into an ordinary download. See `src/domain/pdf-layout.ts` for the why.
 *
 * Image attachments are fetched and measured first — a note loaded from a
 * file/cloud backend carries its attachments' metadata but not their bytes, and
 * a PDF has to carry the picture itself. `fetchAttachment` is the on-demand
 * fetcher from the attachment context; a missing one (or an attachment the
 * backend can't produce) degrades to the image's alt text rather than failing
 * the export.
 *
 * `transforms` are the active display rules — the PDF shows what the screen
 * shows, so a masked run stays masked on paper.
 */
export async function exportPdf(
  note: Note,
  settings: PdfSettings,
  fetchAttachment?: AttachmentFetcher | null,
  transforms?: readonly CompiledTransform[],
): Promise<boolean> {
  try {
    const [{ buildPdf }, images] = await Promise.all([
      import("./pdf-document.ts"),
      resolveImages(note, fetchAttachment),
    ]);
    const blob = await buildPdf({
      title: note.title,
      body: note.body ?? "",
      settings,
      transforms,
      images,
      imageKeyFor: (href) => attachmentFilenameFromHref(href) ?? undefined,
    });
    if (!blob) return false;
    download(blob, `${exportFileStem(note)}.pdf`);
    return true;
  } catch (err) {
    console.warn("[export] pdf failed", err);
    return false;
  }
}

// Every image attachment of the note, as bytes plus the pixel size the layout
// needs to scale it to the column. Attachments that already carry their data
// cost nothing; the rest are fetched in parallel, and anything that fails to
// fetch or decode is left out of the map — the layout prints its alt text.
async function resolveImages(
  note: Note,
  fetchAttachment?: AttachmentFetcher | null,
): Promise<Map<string, LoadedImage>> {
  const out = new Map<string, LoadedImage>();
  const images = (note.attachments ?? []).filter(isImageAttachment);
  await Promise.all(
    images.map(async (attachment: Attachment) => {
      let data = attachment.data;
      if (!data && fetchAttachment) {
        try {
          data =
            (await fetchAttachment(note, attachment.filename)) ?? undefined;
        } catch {
          return;
        }
      }
      if (!data) return;
      const size = await measureImage(data);
      if (size) out.set(attachment.filename, { dataUrl: data, ...size });
    }),
  );
  return out;
}

/** An image's intrinsic size, or `null` if the browser can't decode it. */
function measureImage(
  dataUrl: string,
): Promise<{ widthPx: number; heightPx: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({ widthPx: img.naturalWidth, heightPx: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
