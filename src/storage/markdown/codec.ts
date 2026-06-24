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
import { type Folder, type Note, type Snapshot } from "../../domain/note.ts";

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

// -- Physical folder directories --------------------------------------
//
// A note's folder is a **real subdirectory** on the file/cloud backends: a
// grouped note's `.md` is written into `<folder-dir>/<stem>.md` under the
// namespace's notes root, so the synced folder is browsable and tool-friendly
// (open the `Recipes/` folder in any file manager and there are the recipes).
// The directory name is a slug of the folder's display name, falling back to a
// stable id-derived stem for a name that slugs to nothing (an all-emoji name),
// so every folder still maps to a distinct, deterministic directory. The
// note's `folder:` frontmatter (the folder *id*) stays the authoritative link
// the load reads back — the directory is a write-side projection for browsing,
// and the frontmatter is what's sanity-checked against it — so two folders that
// happen to slug alike never lose a note.

/** The directory segment a folder's notes are filed under (no slashes). */
export function folderDirSegment(folder: Folder): string {
  return slugify(folder.name) || `folder-${idSuffix(folder.id)}`;
}

/**
 * The directory a note is filed under, relative to the notes root: the empty
 * string for an ungrouped note (it lives directly at the root) and the folder's
 * `folderDirSegment` when it points at a known folder. An unknown / missing
 * folder id (no registry, or a stale link) falls back to the root.
 */
export function folderDirName(
  folderId: string | undefined,
  folders: readonly Folder[] | undefined,
): string {
  if (!folderId || !folders) return "";
  const folder = folders.find((f) => f.id === folderId);
  return folder ? folderDirSegment(folder) : "";
}

/**
 * The path a note's `.md` file lives at, relative to the notes root, resolving
 * its folder against the registry: `<folder-dir>/<stem>.md` when grouped,
 * `<stem>.md` when ungrouped.
 */
export function noteFilePath(note: Note, folders?: readonly Folder[]): string {
  const dir = folderDirName(note.folderId, folders);
  const stem = noteFileStem(note);
  return dir ? `${dir}/${stem}.md` : `${stem}.md`;
}

// -- Serialize --------------------------------------------------------

/**
 * Every note in a snapshot, as an individual markdown file. A grouped note is
 * filed into its folder's real subdirectory (`<folder-dir>/<stem>.md`); an
 * ungrouped one sits at the notes root. The on-disk attachment references are
 * pointed up the extra directory level a folder adds so they still resolve in
 * an external markdown viewer.
 */
export function snapshotToFiles(snapshot: Snapshot): MarkdownFile[] {
  return snapshot.notes.map((note) => {
    const dir = folderDirName(note.folderId, snapshot.folders);
    const stem = noteFileStem(note);
    return {
      path: dir ? `${dir}/${stem}.md` : `${stem}.md`,
      text: noteToMarkdown(note, dir ? 1 : 0),
    };
  });
}

/**
 * Serialize one note to its `.md` file contents. `folderDepth` is how many
 * folder directories the note is nested under the notes root (0 ungrouped, 1
 * inside a folder), so the attachment references point up the right number of
 * levels to reach the sibling `attachments/` tree.
 */
export function noteToMarkdown(note: Note, folderDepth = 0): string {
  const front = renderFrontmatter({
    id: note.id,
    // Only written when set, so a title-less note's frontmatter stays minimal.
    ...(note.title ? { title: note.title } : {}),
    created: String(note.createdAt),
    updated: String(note.updatedAt),
    // Only written when the note is archived, so an active note's frontmatter
    // stays minimal and an older file (no flag) round-trips as active.
    ...(note.archived ? { archived: "true" } : {}),
    // The folder the note belongs to, by id. Only written when set, so an
    // ungrouped note's frontmatter stays minimal. The folder's display name
    // lives in the `folders.json` sidecar the directory adapter keeps, so this
    // is just the link — renaming a folder never rewrites every note file.
    ...(note.folderId ? { folder: note.folderId } : {}),
  });
  // Point image references at the on-disk sibling layout
  // (`../attachments/<stem>/<file>`, with an extra `../` per folder level) so
  // the file opens with working images in any markdown viewer; the in-memory
  // body keeps the rename-proof flat form.
  // A note serialized to a markdown file is always one whose body is loaded
  // (plaintext backends never defer, and the encrypted→plaintext path fetches
  // the body first); the `?? ""` is only a defensive guard against a deferred
  // note slipping through, never a path that should write away a real body.
  const body = refsToDisk(
    (note.body ?? "").replace(/\n+$/, ""),
    noteFileStem(note),
    folderDepth,
  );
  // One blank line between the frontmatter and the body, and exactly one
  // trailing newline so the file ends cleanly. Trailing blank lines in the
  // body are trimmed (normalised) before the single newline is re-added.
  return `${front}\n${body}\n`;
}

// -- Attachment references --------------------------------------------
//
// In memory a note body references an attachment by the flat
// `attachments/<file>` (no note-name segment, so it survives a rename) — an
// image as `![file](…)`, any other file as a plain `[file](…)` link. On disk
// the note lives in `notes/[<folder>/]<stem>.md` and the file in the sibling
// `attachments/<stem>/<file>`, so the reference is rewritten to the relative
// `../attachments/<stem>/<file>` on the way out — with one extra `../` for each
// folder directory the note is nested under — and collapsed back to the
// basename on the way in. The optional leading `!` matches both forms; a
// non-attachment href (an ordinary link) is left untouched.

const ATTACHMENT_REF_RE = /(!?\[[^\]]*\]\()([^)]+)(\))/g;

function refsToDisk(body: string, stem: string, folderDepth = 0): string {
  // One `../` climbs out of the notes root to the namespace root (where the
  // `attachments/` tree sits beside `notes/`); each folder directory the note
  // is filed under adds one more.
  const up = "../".repeat(1 + folderDepth);
  return body.replace(
    ATTACHMENT_REF_RE,
    (whole, open: string, href: string, close: string) => {
      const filename = attachmentFilenameFromHref(href);
      if (!filename) return whole;
      return `${open}${up}${ATTACHMENT_REF_PREFIX}${stem}/${filename}${close}`;
    },
  );
}

function refsFromDisk(body: string): string {
  return body.replace(
    ATTACHMENT_REF_RE,
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
  // Carry the folder link only when present, mirroring how it's written.
  if (front.folder) note.folderId = front.folder;
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
