// The parse / serialize seam every adapter runs through. Adapters carry
// opaque bytes (see `./adapter.ts`); this module is the one place that turns
// a domain `Snapshot` into the stored text and back, so the forward-only
// migration chain (`./migrations.ts`) and defensive parsing live here
// instead of being duplicated per backend.
//
// Versioning lives in the bytes, not in the domain `Snapshot`: the stored
// JSON carries a top-level `version` that `parse` migrates forward and
// `serialize` stamps, while `domain/` keeps working with the version-free
// `Snapshot` shape.

import type { Attachment } from "../domain/attachment.ts";
import {
  emptySnapshot,
  type Folder,
  type Note,
  type Snapshot,
} from "../domain/note.ts";
import { createLogger } from "../dev/logger.ts";
import { LATEST_VERSION, migrate } from "./migrations.ts";

const log = createLogger("serialize");

/** Produce the canonical stored text for a document (trailing newline). */
export function serialize(snapshot: Snapshot): string {
  const doc = {
    version: LATEST_VERSION,
    ...snapshot,
    notes: snapshot.notes.map(serializeNote),
  };
  return JSON.stringify(doc, null, 2) + "\n";
}

// Normalise one note for storage. A **deferred** note (body not loaded — the
// lazy encrypted backends carry only metadata + a preview until a note is
// opened) is written with a `deferred` marker and its `preview`, but no `body`,
// so a re-parse round-trips it as deferred rather than as a real note with an
// empty body (which would later be saved over the ciphertext). A loaded note is
// written with its `body` and without the transient `preview`/`deferred` hints,
// which are recomputed from the body when needed.
function serializeNote(note: Note): Record<string, unknown> {
  const out: Record<string, unknown> = { ...note };
  if (note.body === undefined) {
    delete out.body;
    out.deferred = true;
    if (note.preview === undefined) delete out.preview;
  } else {
    delete out.preview;
    delete out.deferred;
  }
  return out;
}

// `title` is intentionally not required here: the v1 → v2 migration adds it,
// but tolerating its absence (defaulting it in `parse`) keeps a hand-edited or
// partially-written note loadable rather than silently dropped. `body` is
// likewise tolerated as absent when the note is explicitly `deferred` (a lazy
// encrypted backend's metadata-only note); a non-deferred note still requires a
// string body.
function isNote(value: unknown): value is Omit<Note, "title"> {
  if (!value || typeof value !== "object") return false;
  const n = value as Record<string, unknown>;
  const bodyOk = typeof n.body === "string" || n.deferred === true;
  return (
    typeof n.id === "string" &&
    bodyOk &&
    typeof n.createdAt === "number" &&
    typeof n.updatedAt === "number"
  );
}

/**
 * Parse stored text back into a `Snapshot`, running the migration chain and
 * tolerating absent or corrupt bytes by falling back to an empty document.
 * A document written by a newer build (migration throws) also falls back to
 * empty rather than crashing the load. Individual malformed notes are
 * dropped defensively so one bad entry can't hide the rest.
 */
export function parse(text: string | null | undefined): Snapshot {
  if (!text) return emptySnapshot();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptySnapshot();
  }
  let migrated: unknown;
  try {
    migrated = migrate(raw).data;
  } catch (err) {
    log.error("parse: migration failed — falling back to empty document", err);
    return emptySnapshot();
  }
  const doc = migrated as { notes?: unknown[]; folders?: unknown };
  const notes: Note[] = Array.isArray(doc.notes)
    ? doc.notes.filter(isNote).map((n) => {
        const title = (n as { title?: unknown }).title;
        const attachments = parseAttachments(
          (n as { attachments?: unknown }).attachments,
        );
        const note: Note = {
          ...n,
          title: typeof title === "string" ? title : "",
        };
        // A deferred note carries no `body` (it lives in its own .enc) — keep
        // it `undefined` and restore the preview snippet. The `deferred` marker
        // is a storage detail, never a domain field, so drop it from the note.
        const deferred =
          (n as { deferred?: unknown }).deferred === true &&
          typeof (n as { body?: unknown }).body !== "string";
        delete (note as { deferred?: unknown }).deferred;
        if (deferred) {
          delete note.body;
          const preview = (n as { preview?: unknown }).preview;
          if (typeof preview === "string") note.preview = preview;
          else delete note.preview;
        } else {
          delete note.preview;
        }
        if (attachments.length > 0) note.attachments = attachments;
        else delete note.attachments;
        // Keep a folder reference only when it's a non-empty string; a junk
        // value (or a stray `null`) drops to "ungrouped" rather than riding
        // through via the `...n` spread.
        const folderId = (n as { folderId?: unknown }).folderId;
        if (typeof folderId === "string" && folderId.length > 0) {
          note.folderId = folderId;
        } else {
          delete note.folderId;
        }
        return note;
      })
    : [];
  const folders = parseFolders(doc.folders);
  const snapshot: Snapshot = { notes };
  if (folders.length > 0) snapshot.folders = folders;
  return snapshot;
}

function isFolder(value: unknown): value is Folder {
  if (!value || typeof value !== "object") return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.id === "string" &&
    f.id.length > 0 &&
    typeof f.name === "string" &&
    typeof f.createdAt === "number"
  );
}

/**
 * Parse a folder registry defensively: drop malformed entries and collapse
 * duplicate ids to the first seen, mirroring how `parse` drops bad notes. A
 * missing or non-array value yields none. Exported so the file backends can
 * parse a standalone `folders.json` sidecar through the same validation.
 */
export function parseFolders(value: unknown): Folder[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Folder[] = [];
  for (const entry of value) {
    if (!isFolder(entry)) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push({ id: entry.id, name: entry.name, createdAt: entry.createdAt });
  }
  return out;
}

/** Serialize a folder registry to the JSON stored in a `folders.json` sidecar. */
export function serializeFolders(folders: readonly Folder[]): string {
  return JSON.stringify(folders);
}

// Drop any malformed attachment entry rather than failing the whole note, the
// same defensive stance `isNote` takes for notes. A note's attachments are
// optional, so an absent or non-array value yields none.
function parseAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  const out: Attachment[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const a = entry as Record<string, unknown>;
    if (
      typeof a.filename === "string" &&
      typeof a.mime === "string" &&
      a.filename.length > 0
    ) {
      // `data` is optional: a note loaded from a file/cloud backend carries
      // only its attachments' metadata until the bytes are fetched on demand.
      const att: Attachment = { filename: a.filename, mime: a.mime };
      if (typeof a.data === "string" && a.data.length > 0) att.data = a.data;
      out.push(att);
    }
  }
  return out;
}
