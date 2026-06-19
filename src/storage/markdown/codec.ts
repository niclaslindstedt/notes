// Markdown codec: turns a domain `Snapshot` into a set of individual
// markdown files (one per note) and back. This is what makes the file-based
// backends (local folder, Dropbox, Google Drive) store human-readable,
// tool-interoperable `.md` files instead of one opaque JSON blob — open a
// note in any editor, render it on GitHub, or commit it to git and it reads
// as plain text.
//
// The codec is pure (no DOM, no I/O) and lives in `storage/` rather than
// `domain/` because the on-disk *representation* is a persistence concern;
// `domain/` keeps working with the `Snapshot` shape.
//
// A note's body is stored verbatim under a small YAML-ish frontmatter block
// that carries the fields the body can't express (the stable id, the user's
// title, and the created / updated timestamps). The title is its own field —
// edited separately from the body — so it rides the frontmatter rather than
// being recovered from the first body line.

import {
  ATTACHMENT_REF_PREFIX,
  attachmentFilenameFromHref,
} from "../../domain/attachment.ts";
import { type Note, type Snapshot } from "../../domain/note.ts";

/** A single markdown document keyed by its path relative to the app root. */
export type MarkdownFile = {
  /** e.g. `groceries-1a2b3c.md`. */
  path: string;
  /** The full file contents: frontmatter + body + a trailing newline. */
  text: string;
};

// -- Filenames --------------------------------------------------------

/**
 * Folder-/tool-friendly file stem for a note: a slug of its title, suffixed
 * with a short slice of its id so two notes that share a title never collide
 * and the stem is deterministic from (title, id). An edit that changes the
 * title changes the stem, so the old file is reconciled away on the next save
 * (see the directory adapter) — but routine body typing no longer renames the
 * file, since the stem rides the title rather than the first body line.
 */
export function noteFileStem(note: Note): string {
  const base = slugify(note.title) || "note";
  return `${base}-${idSuffix(note.id)}`;
}

function idSuffix(id: string): string {
  const compact = id.replace(/[^a-z0-9]/gi, "");
  return (compact.slice(-6) || compact || "id").toLowerCase();
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

// -- Serialize --------------------------------------------------------

/** Every note in a snapshot, as an individual markdown file. */
export function snapshotToFiles(snapshot: Snapshot): MarkdownFile[] {
  return snapshot.notes.map((note) => ({
    path: `${noteFileStem(note)}.md`,
    text: noteToMarkdown(note),
  }));
}

export function noteToMarkdown(note: Note): string {
  const front = renderFrontmatter({
    id: note.id,
    // Only written when set, so a title-less note's frontmatter stays minimal.
    ...(note.title ? { title: note.title } : {}),
    created: String(note.createdAt),
    updated: String(note.updatedAt),
    // Only written when the note is archived, so an active note's frontmatter
    // stays minimal and an older file (no flag) round-trips as active.
    ...(note.archived ? { archived: "true" } : {}),
  });
  // Point image references at the on-disk sibling layout
  // (`../attachments/<stem>/<file>`) so the file opens with working images in
  // any markdown viewer; the in-memory body keeps the rename-proof flat form.
  const body = refsToDisk(note.body.replace(/\n+$/, ""), noteFileStem(note));
  // One blank line between the frontmatter and the body, and exactly one
  // trailing newline so the file ends cleanly. Trailing blank lines in the
  // body are trimmed (normalised) before the single newline is re-added.
  return `${front}\n${body}\n`;
}

// -- Attachment references --------------------------------------------
//
// In memory a note body references an image by the flat `attachments/<file>`
// (no note-name segment, so it survives a rename); on disk the note lives in
// `notes/<stem>.md` and the image in the sibling `attachments/<stem>/<file>`,
// so the reference is rewritten to the relative `../attachments/<stem>/<file>`
// on the way out and collapsed back to the basename on the way in.

const IMAGE_REF_RE = /(!\[[^\]]*\]\()([^)]+)(\))/g;

function refsToDisk(body: string, stem: string): string {
  return body.replace(
    IMAGE_REF_RE,
    (whole, open: string, href: string, close: string) => {
      const filename = attachmentFilenameFromHref(href);
      if (!filename) return whole;
      return `${open}../${ATTACHMENT_REF_PREFIX}${stem}/${filename}${close}`;
    },
  );
}

function refsFromDisk(body: string): string {
  return body.replace(
    IMAGE_REF_RE,
    (whole, open: string, href: string, close: string) => {
      const filename = attachmentFilenameFromHref(href);
      if (!filename) return whole;
      return `${open}${ATTACHMENT_REF_PREFIX}${filename}${close}`;
    },
  );
}

function renderFrontmatter(fields: Record<string, string>): string {
  const body = Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return `---\n${body}\n---\n`;
}

// -- Parse ------------------------------------------------------------

/**
 * Reconstruct a `Snapshot` from a set of markdown files. Files that fail to
 * parse (missing frontmatter or id) are skipped rather than failing the whole
 * load — a single bad file shouldn't hide every other note. Order follows the
 * input file order.
 */
export function filesToSnapshot(files: readonly MarkdownFile[]): Snapshot {
  const notes: Note[] = [];
  for (const file of files) {
    const note = parseNote(file.text);
    if (note) notes.push(note);
  }
  return { notes };
}

export function parseNote(text: string): Note | null {
  const { front, body } = splitFrontmatter(text);
  if (!front) return null;
  const id = front.id ?? "";
  if (!id) return null;
  const title = front.title ?? "";
  const createdAt = toEpoch(front.created);
  const updatedAt = front.updated ? toEpoch(front.updated) : createdAt;
  // Drop the single trailing newline `noteToMarkdown` adds; keep the body
  // otherwise verbatim.
  const note: Note = {
    id,
    title,
    // Drop the single trailing newline, then collapse any on-disk attachment
    // reference back to the flat in-memory form.
    body: refsFromDisk(body.replace(/\n$/, "")),
    createdAt,
    updatedAt,
  };
  // Carry the archived flag only when set, mirroring how it's written — an
  // active note never gains an explicit `archived: false`.
  if (front.archived === "true") note.archived = true;
  return note;
}

// Frontmatter timestamps are epoch-ms numbers written as strings. Tolerate a
// non-numeric value (a hand-edited file) by falling back to 0 so the note
// still loads rather than carrying a `NaN` timestamp.
function toEpoch(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function splitFrontmatter(text: string): {
  front: Record<string, string> | null;
  body: string;
} {
  const normalized = text.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (!match) return { front: null, body: normalized };
  const front: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) front[key] = value;
  }
  // The body starts after the frontmatter block; `noteToMarkdown` inserts one
  // blank line there, so drop a single leading newline to recover the body.
  return { front, body: normalized.slice(match[0].length).replace(/^\n/, "") };
}
