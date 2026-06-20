// Attachments: the pure data + pure helpers for a file a user pastes or drops
// into a note. An attachment is either an **image** (shown inline as a
// clickable thumbnail) or any **other file** (shown as a file chip with a
// type icon — no preview, just a downloadable attachment). Like the rest of
// `domain/`, this layer has no DOM and no I/O — the editor (UI) decodes the
// pasted blob and generates the preview, the storage layer externalises the
// bytes to a file; this module only owns the model and the filename /
// markdown-reference conventions both sides agree on.
//
// On the file backends an attachment becomes a real file on disk under an
// `attachments/<note-name>/<filename>` folder beside the note's `.md` (see
// `storage/directory-adapter.ts`); in memory it rides on the `Note` as a
// `data:` URL so the editor can render the thumbnail / chip and the
// click-to-open viewer (or a download) without a round-trip to the backend.
//
// The body reference tells the two kinds apart: an image is referenced as an
// image (`![file](attachments/file)`), an other-file as a plain link
// (`[file](attachments/file)`), so the renderer knows whether to draw a
// thumbnail or a file chip.

// A single file attached to a note. `filename` is unique within the note and
// is both the on-disk filename and the basename a body reference points at;
// `data` is the full file as a `data:` URL (the in-memory canonical form the
// storage layer splits out into a file and re-hydrates on load).
export type Attachment = {
  filename: string;
  mime: string;
  data: string;
};

/** Whether an attachment is an image (rendered inline as a thumbnail) rather
 * than a generic file (rendered as a downloadable chip). Keyed off the MIME
 * type, which the file backends recover from the extension on re-hydrate. */
export function isImageAttachment(attachment: Attachment): boolean {
  return attachment.mime.startsWith("image/");
}

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

// Common non-image extensions mapped to a MIME type, so a re-hydrated file
// attachment carries a sensible type for its download (and so `isImageAttachment`
// stays false for it). Not exhaustive — anything missing falls back to the
// generic binary type, which still downloads fine.
const EXT_TO_FILE_MIME: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

/** The file extension (no dot), lowercased, of a filename — `""` when none. */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

/**
 * The MIME type for a stored attachment filename, by its extension — the
 * inverse of `extensionForMime`, used when re-hydrating an attachment from a
 * file on disk (where only the name survives). Recognises the image types and
 * a set of common file types; falls back to a generic binary type for an
 * unrecognised extension.
 */
export function mimeForFilename(filename: string): string {
  const ext = extensionOf(filename);
  for (const [mime, e] of Object.entries(MIME_TO_EXT)) {
    if (e === ext) return mime;
  }
  return EXT_TO_FILE_MIME[ext] ?? "application/octet-stream";
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

/**
 * Mint a unique, filesystem-safe filename for a pasted/dropped non-image file,
 * keeping the original extension (an image's extension comes from its MIME via
 * `attachmentFilename`, but an arbitrary file's type may be unknown, so its
 * own extension is the reliable one — a `report.pdf` must stay a `.pdf`). A
 * file with no extension keeps none.
 */
export function fileAttachmentFilename(
  original: string,
  rand: string = shortRand(),
): string {
  const base = slugifyName(original) || "file";
  const ext = extensionOf(original).replace(/[^a-z0-9]/g, "");
  return ext ? `${rand}-${base}.${ext}` : `${rand}-${base}`;
}

/** The in-memory body reference (the href) for an attachment. */
export function attachmentRef(filename: string): string {
  return `${ATTACHMENT_REF_PREFIX}${filename}`;
}

/**
 * The markdown an attachment is inserted into the body as: an image reference
 * (`![file](…)`) for an image so it renders as a thumbnail, a plain link
 * (`[file](…)`) for any other file so it renders as a downloadable file chip.
 */
export function attachmentMarkdown(attachment: Attachment): string {
  const ref = attachmentRef(attachment.filename);
  return isImageAttachment(attachment)
    ? `![${attachment.filename}](${ref})`
    : `[${attachment.filename}](${ref})`;
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

// A body reference to an attachment: an image `![alt](href)` or a plain
// `[text](href)` link. The leading `!` is optional so the same scan finds both
// image thumbnails and file chips; a non-attachment href is filtered out by
// `attachmentFilenameFromHref` returning null.
const ATTACHMENT_REF_RE = /!?\[[^\]]*\]\(([^)]+)\)/g;

// A whole line that is exactly one attachment reference (and nothing else).
// `[1]` is the leading `!` (image) or empty (file); `[2]` is the href.
const ATTACHMENT_LINE_RE = /^(!?)\[[^\]]*\]\(([^)]+)\)$/;

/**
 * The attachments actually referenced by a body, in body order. Used to prune
 * attachments whose reference was deleted from the text so an orphaned file
 * doesn't linger on disk. An attachment referenced more than once appears
 * once.
 */
export function referencedAttachments(
  body: string,
  attachments: readonly Attachment[] | undefined,
): Attachment[] {
  if (!attachments || attachments.length === 0) return [];
  const referenced = new Set<string>();
  let m: RegExpExecArray | null;
  ATTACHMENT_REF_RE.lastIndex = 0;
  while ((m = ATTACHMENT_REF_RE.exec(body)) !== null) {
    const filename = attachmentFilenameFromHref(m[1]!);
    if (filename) referenced.add(filename);
  }
  return attachments.filter((a) => referenced.has(a.filename));
}

// ---------------------------------------------------------------------------
// Placement — render attachments inline, or collected at the end of the note
// ---------------------------------------------------------------------------

// Where the editor / read-only view shows a note's attachments. References
// always stay inline in the body source; this only governs where they
// *render* — in place, or hidden inline and re-rendered in a collected block
// at the foot of the note. Images and other files are governed independently.
export type AttachmentPlacement = {
  imagesAtEnd: boolean;
  filesAtEnd: boolean;
};

export const INLINE_PLACEMENT: AttachmentPlacement = {
  imagesAtEnd: false,
  filesAtEnd: false,
};

/**
 * Whether a body line is a single attachment reference that the placement
 * relocates to the end — so the renderer can hide the whole line (and not just
 * the node) to avoid leaving an empty gap where the attachment was.
 */
export function isRelocatedAttachmentLine(
  line: string,
  placement: AttachmentPlacement,
): boolean {
  const m = ATTACHMENT_LINE_RE.exec(line.trim());
  if (!m) return false;
  if (attachmentFilenameFromHref(m[2]!) === null) return false;
  return m[1] === "!" ? placement.imagesAtEnd : placement.filesAtEnd;
}

/**
 * The set of body-line indices to hide because their attachment is rendered at
 * the end instead. A blank line immediately following a hidden attachment line
 * is absorbed too (the editor inserts one after each attachment), so a run of
 * relocated images doesn't leave a stack of empty lines behind.
 */
export function hiddenAttachmentLines(
  body: string,
  placement: AttachmentPlacement,
): Set<number> {
  const hidden = new Set<number>();
  if (!placement.imagesAtEnd && !placement.filesAtEnd) return hidden;
  body.split("\n").forEach((line, i) => {
    if (isRelocatedAttachmentLine(line, placement)) hidden.add(i);
    else if (line.trim() === "" && hidden.has(i - 1)) hidden.add(i);
  });
  return hidden;
}

/**
 * Split a note's attachments into the images and files that the placement
 * relocates to the end, in attachment order. Either list is empty when its
 * kind renders inline. Used by the collected end-of-note block.
 */
export function relocatedAttachments(
  attachments: readonly Attachment[] | undefined,
  placement: AttachmentPlacement,
): { images: Attachment[]; files: Attachment[] } {
  const images: Attachment[] = [];
  const files: Attachment[] = [];
  for (const a of attachments ?? []) {
    if (isImageAttachment(a)) {
      if (placement.imagesAtEnd) images.push(a);
    } else if (placement.filesAtEnd) {
      files.push(a);
    }
  }
  return { images, files };
}
