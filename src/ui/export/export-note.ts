// The three things the export menu does with the open note: write it to a
// `.md` file, print it to PDF, and put it on the clipboard. Each is a plain
// async function so the button component stays presentational.
//
// The pure parts live elsewhere: `buildCopyText` (`src/ui/copy-note.ts`) builds
// the clipboard/Markdown text, `renderPrintDocument` (`src/domain/pdf-render.ts`)
// builds the printable page, and `printHtmlDocument`
// (`./print-document.ts`) puts that page in front of the platform's print
// engine. What's here is the glue: filenames, the download anchor, and
// resolving a note's image attachments to `data:` URLs so they survive into the
// PDF.

import {
  attachmentFilenameFromHref,
  isImageAttachment,
  type Attachment,
} from "../../domain/attachment.ts";
import { renderPrintDocument } from "../../domain/pdf-render.ts";
import type { PdfSettings } from "../../domain/pdf.ts";
import type { CompiledTransform } from "../../domain/transform.ts";
import type { Note } from "../../domain/note.ts";
import { noteToMarkdown } from "../../storage/markdown/codec.ts";
import type { AttachmentFetcher } from "../attachments/fetch-context.ts";
import { printHtmlDocument } from "./print-document.ts";

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
  const blob = new Blob([noteToMarkdown(note)], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportFileStem(note)}.md`;
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
 * Render the open note with the user's PDF settings and raise the print dialog,
 * where "Save as PDF" writes the file.
 *
 * Image attachments are resolved to `data:` URLs first — a note loaded from a
 * file/cloud backend carries its attachments' metadata but not their bytes, and
 * the print document is standalone, so an unfetched image would print as a gap.
 * `fetchAttachment` is the on-demand fetcher from the attachment context; a
 * missing one (or an attachment the backend can't produce) degrades to the
 * image's alt text rather than failing the export.
 *
 * `transforms` are the active display rules — the PDF shows what the screen
 * shows, so a masked run stays masked on paper. See `PrintDocument`.
 */
export async function exportPdf(
  note: Note,
  settings: PdfSettings,
  fetchAttachment?: AttachmentFetcher | null,
  transforms?: readonly CompiledTransform[],
): Promise<boolean> {
  const images = await resolveImages(note, fetchAttachment);
  const html = renderPrintDocument({
    title: note.title,
    body: note.body ?? "",
    settings,
    transforms,
    resolveImage: (href) => {
      const filename = attachmentFilenameFromHref(href);
      return filename ? images.get(filename) : undefined;
    },
  });
  return printHtmlDocument(html);
}

// Every image attachment of the note as `filename → data: URL`. Attachments
// that already carry their bytes cost nothing; the rest are fetched in
// parallel, and anything that fails is simply left out of the map.
async function resolveImages(
  note: Note,
  fetchAttachment?: AttachmentFetcher | null,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const images = (note.attachments ?? []).filter(isImageAttachment);
  await Promise.all(
    images.map(async (attachment: Attachment) => {
      if (attachment.data) {
        out.set(attachment.filename, attachment.data);
        return;
      }
      if (!fetchAttachment) return;
      try {
        const data = await fetchAttachment(note, attachment.filename);
        if (data) out.set(attachment.filename, data);
      } catch {
        // An attachment the backend can't produce prints as its alt text.
      }
    }),
  );
  return out;
}
