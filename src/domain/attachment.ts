// Image attachments: the pure data + pure helpers for an image a user pastes
// or drops into a note. Like the rest of `domain/`, this layer has no DOM and
// no I/O — the editor (UI) decodes the pasted blob and generates the preview,
// the storage layer externalises the bytes to a file; this module only owns
// the model and the filename / markdown-reference conventions both sides agree
// on.
//
// On the file backends an attachment becomes a real image file on disk under
// an `attachments/<note-name>/<filename>` folder beside the note's `.md` (see
// `storage/directory-adapter.ts`); in memory it rides on the `Note` as a
// `data:` URL so the editor can render the thumbnail and the click-to-open
// viewer without a round-trip to the backend.

// A single image attached to a note. `filename` is unique within the note and
// is both the on-disk filename and the basename a body image-reference points
// at; `data` is the full image as a `data:` URL (the in-memory canonical form
// the storage layer splits out into a file and re-hydrates on load).
export type Attachment = {
  filename: string;
  mime: string;
  data: string;
};

// The folder, relative to a note file, that an attachment reference resolves
// against. In memory a reference is the flat `attachments/<filename>` (no
// note-name segment, so it survives a note rename); the markdown codec maps it
// to the on-disk `../attachments/<note-name>/<filename>` and back.
export const ATTACHMENT_REF_PREFIX = "attachments/";

// Image MIME types the editor accepts on paste / drop, mapped to the file
// extension the attachment is stored under. Kept small and explicit rather
// than trusting an arbitrary `image/*` so an exotic type can't land a file
// with a surprising extension.
const MIME_TO_EXT: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

/** Whether a MIME type is an image the editor will accept as an attachment. */
export function isAttachableImageMime(mime: string): boolean {
  return Object.prototype.hasOwnProperty.call(MIME_TO_EXT, mime);
}

/** The file extension (no dot) an attachment of this MIME is stored under. */
export function extensionForMime(mime: string): string {
  return MIME_TO_EXT[mime] ?? "bin";
}

/**
 * The MIME type for a stored attachment filename, by its extension — the
 * inverse of `extensionForMime`, used when re-hydrating an attachment from a
 * file on disk (where only the name survives). Falls back to a generic binary
 * type for an unrecognised extension.
 */
export function mimeForFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
  for (const [mime, e] of Object.entries(MIME_TO_EXT)) {
    if (e === ext) return mime;
  }
  return "application/octet-stream";
}

function shortRand(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

// Folder-/tool-friendly slug for the original filename's stem, so a pasted
// "Screenshot 2026.png" lands as a readable `screenshot-2026`.
function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/**
 * Mint a unique, filesystem-safe filename for a pasted/dropped image: a short
 * random prefix (so two pastes of the same picture never collide) plus a slug
 * of the original name, suffixed with the MIME's extension. A clipboard paste
 * carries no filename, so `original` is optional and falls back to `image`.
 */
export function attachmentFilename(
  mime: string,
  original?: string,
  rand: string = shortRand(),
): string {
  const base = (original && slugifyName(original)) || "image";
  return `${rand}-${base}.${extensionForMime(mime)}`;
}

/** The in-memory body reference (the href) for an attachment. */
export function attachmentRef(filename: string): string {
  return `${ATTACHMENT_REF_PREFIX}${filename}`;
}

/** The markdown an image attachment is inserted into the body as. */
export function attachmentMarkdown(attachment: Attachment): string {
  return `![${attachment.filename}](${attachmentRef(attachment.filename)})`;
}

/**
 * The attachment filename a body image-reference points at, or null when the
 * href isn't an attachment reference. Tolerates the on-disk form
 * (`../attachments/<note-name>/<file>`) as well as the in-memory flat form so a
 * resolver works whichever shape it's handed.
 */
export function attachmentFilenameFromHref(href: string): string | null {
  const marker = href.lastIndexOf(ATTACHMENT_REF_PREFIX);
  if (marker === -1) return null;
  const rest = href.slice(marker + ATTACHMENT_REF_PREFIX.length);
  if (rest.length === 0) return null;
  // Flat form is the basename already; disk form has a `<note-name>/` segment.
  const slash = rest.lastIndexOf("/");
  return slash === -1 ? rest : rest.slice(slash + 1);
}

/**
 * Append an attachment to a note (de-duplicating by filename). Pure: returns a
 * new note; never mutates the input. `updatedAt` is the caller's concern — the
 * body edit that inserts the reference bumps it.
 */
export function withAttachment(
  attachments: readonly Attachment[] | undefined,
  attachment: Attachment,
): Attachment[] {
  const without = (attachments ?? []).filter(
    (a) => a.filename !== attachment.filename,
  );
  return [...without, attachment];
}

/**
 * The attachments actually referenced by a body, in body order. Used to prune
 * attachments whose reference was deleted from the text so an orphaned image
 * file doesn't linger on disk. An attachment referenced more than once appears
 * once.
 */
export function referencedAttachments(
  body: string,
  attachments: readonly Attachment[] | undefined,
): Attachment[] {
  if (!attachments || attachments.length === 0) return [];
  const referenced = new Set<string>();
  const re = /!\[[^\]]*\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const filename = attachmentFilenameFromHref(m[1]!);
    if (filename) referenced.add(filename);
  }
  return attachments.filter((a) => referenced.has(a.filename));
}
