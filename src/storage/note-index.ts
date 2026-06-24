// The encrypted **note index**: one small sealed file that lists every note's
// metadata (id, title, timestamps, folder, archived flag, attachment metadata)
// plus a `preview` snippet — everything the list/tree needs to render — but
// **not** the note bodies. It exists so unlocking a large encrypted vault is one
// read + one decrypt (render the whole list instantly) instead of reading and
// decrypting every per-note `.enc` file up front; each note's body is then
// decrypted lazily when the note is opened (and warmed in the background for
// offline use). See `docs/overview.md#encryption`.
//
// The index is a pure **optimisation**, never the source of truth: the per-note
// `.enc` files and the directory listing remain authoritative. On load the
// directory adapter reconciles the index against the listing — any note file
// the index doesn't cover (a stale index, or one another device just added) is
// decrypted individually as a fallback — so a lost or out-of-date index only
// costs a little extra work, never correctness. For that reason the index is
// written best-effort (last-writer-wins) and is *never* conflict-checked, which
// is what lets per-file sync keep working unchanged.
//
// This module is pure: it shapes/validates the index JSON. The directory adapter
// owns sealing it (with the session content key) and writing/reading the file.

import { type Note, notePreviewBlock } from "../domain/note.ts";

const INDEX_TAG = "notes.index.v1" as const;

// Attachment metadata as the index carries it — filename + mime, never bytes
// (those live in their own encrypted blobs, fetched on demand).
export type IndexAttachment = { filename: string; mime: string };

// One note's row in the index. `preview` is the block-form excerpt the list
// renders while the body is deferred; `rev` is the note's `.enc` file revision
// when the index was last written, so the load can tell a fresh index entry
// (rev matches the listing) from a stale one (rev moved → decrypt that note).
export type IndexEntry = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
  folderId?: string;
  attachments?: IndexAttachment[];
  preview: string;
  rev?: string;
};

// Build an index row from a note. Works for a loaded note (preview computed from
// the body) and a deferred one alike — `notePreviewBlock` already falls back to
// the note's carried `preview` when the body isn't loaded — so re-indexing a
// vault where most notes are still deferred keeps their previews intact.
export function noteToIndexEntry(note: Note, rev?: string): IndexEntry {
  const entry: IndexEntry = {
    id: note.id,
    title: note.title,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    preview: notePreviewBlock(note),
  };
  if (note.archived) entry.archived = true;
  if (note.folderId) entry.folderId = note.folderId;
  if (note.attachments && note.attachments.length > 0) {
    entry.attachments = note.attachments.map((a) => ({
      filename: a.filename,
      mime: a.mime,
    }));
  }
  if (rev !== undefined) entry.rev = rev;
  return entry;
}

// Rebuild a **deferred** note from an index row: all the metadata, the preview,
// and `body` left `undefined` so the snapshot knows the body must be fetched on
// open. The bytes of any attachments stay deferred too (metadata only).
export function indexEntryToNote(entry: IndexEntry): Note {
  const note: Note = {
    id: entry.id,
    title: entry.title,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    preview: entry.preview,
  };
  if (entry.archived) note.archived = true;
  if (entry.folderId) note.folderId = entry.folderId;
  if (entry.attachments && entry.attachments.length > 0) {
    note.attachments = entry.attachments.map((a) => ({
      filename: a.filename,
      mime: a.mime,
    }));
  }
  return note;
}

/** The JSON written into the (sealed) index file. */
export function serializeIndex(entries: readonly IndexEntry[]): string {
  return JSON.stringify({ v: INDEX_TAG, entries });
}

// Parse the index JSON defensively: a malformed file, an unknown tag, or a bad
// row yields null / drops the row rather than throwing, so a corrupt index just
// falls back to per-note decryption (the authoritative path) instead of failing
// the load.
export function parseIndex(
  json: string | null | undefined,
): IndexEntry[] | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { v?: unknown; entries?: unknown };
  if (obj.v !== INDEX_TAG || !Array.isArray(obj.entries)) return null;
  const out: IndexEntry[] = [];
  for (const item of obj.entries) {
    const entry = parseEntry(item);
    if (entry) out.push(entry);
  }
  return out;
}

function parseEntry(value: unknown): IndexEntry | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  if (
    typeof e.id !== "string" ||
    typeof e.createdAt !== "number" ||
    typeof e.updatedAt !== "number"
  ) {
    return null;
  }
  const entry: IndexEntry = {
    id: e.id,
    title: typeof e.title === "string" ? e.title : "",
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    preview: typeof e.preview === "string" ? e.preview : "",
  };
  if (e.archived === true) entry.archived = true;
  if (typeof e.folderId === "string" && e.folderId.length > 0) {
    entry.folderId = e.folderId;
  }
  if (Array.isArray(e.attachments)) {
    const atts: IndexAttachment[] = [];
    for (const a of e.attachments) {
      if (a && typeof a === "object") {
        const m = a as Record<string, unknown>;
        if (typeof m.filename === "string" && typeof m.mime === "string") {
          atts.push({ filename: m.filename, mime: m.mime });
        }
      }
    }
    if (atts.length > 0) entry.attachments = atts;
  }
  if (typeof e.rev === "string") entry.rev = e.rev;
  return entry;
}
