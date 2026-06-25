// The JSON codec for an encrypted per-note file: the bytes sealed inside each
// `<ref>.enc` are exactly `noteToEncJson(note)`, and an encrypted load decodes
// them back with `encJsonToNote`. This is deliberately a standalone, pure module
// (no closure state, no I/O) so the one invariant that matters most in the
// storage layer is enforced structurally: the encrypted-note encoding must stay
// **identical** wherever a note is sealed — `save()` and `migrateNote()` both
// call `noteToEncJson` here, so they can never drift into two encodings (a
// divergence would change a note's content hash and trip an infinite
// re-upload loop). Keeping the codec in one tested place is what makes that
// guarantee cheap to verify.

import type { Attachment } from "../domain/attachment.ts";
import type { Note } from "../domain/note.ts";

// Minimal per-note JSON stored inside an encrypted note file: the note minus
// its attachment *bytes* (those live in their own blobs), plus attachment
// metadata so the load knows what to fetch. The opaque ref is re-derived, never
// stored.
type EncAttachmentMeta = { filename: string; mime: string };

// Serialize a note to the canonical JSON sealed into its `.enc` file. Optional
// fields are omitted when falsy so the encoding is stable (an absent
// `attachments`/`folderId`/`archived` never differs from `[]`/`""`/`false`),
// which keeps the content hash stable across saves that don't touch them.
export function noteToEncJson(note: Note): string {
  const meta: EncAttachmentMeta[] = (note.attachments ?? []).map((a) => ({
    filename: a.filename,
    mime: a.mime,
  }));
  const obj: Record<string, unknown> = {
    id: note.id,
    title: note.title,
    body: note.body,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
  if (note.archived) obj.archived = true;
  if (note.folderId) obj.folderId = note.folderId;
  if (meta.length > 0) obj.attachments = meta;
  return JSON.stringify(obj);
}

// Parse the JSON out of a decrypted `.enc` file back into a note, tolerating
// anything malformed by yielding null (a corrupt/foreign file is skipped, not
// fatal). Attachments come back as metadata only — the bytes live in separate
// blobs, fetched on demand.
export function encJsonToNote(json: string): Note | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Record<string, unknown>;
  if (
    typeof n.id !== "string" ||
    typeof n.body !== "string" ||
    typeof n.createdAt !== "number" ||
    typeof n.updatedAt !== "number"
  ) {
    return null;
  }
  const note: Note = {
    id: n.id,
    title: typeof n.title === "string" ? n.title : "",
    body: n.body,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
  if (n.archived === true) note.archived = true;
  if (typeof n.folderId === "string" && n.folderId.length > 0) {
    note.folderId = n.folderId;
  }
  if (Array.isArray(n.attachments)) {
    const meta: Attachment[] = [];
    for (const a of n.attachments) {
      if (a && typeof a === "object") {
        const m = a as Record<string, unknown>;
        if (typeof m.filename === "string" && typeof m.mime === "string") {
          // Metadata only — the bytes live in a separate blob, fetched on demand.
          meta.push({ filename: m.filename, mime: m.mime });
        }
      }
    }
    if (meta.length > 0) note.attachments = meta;
  }
  return note;
}
