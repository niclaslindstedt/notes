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

import { emptySnapshot, type Note, type Snapshot } from "../domain/note.ts";
import { createLogger } from "../dev/logger.ts";
import { LATEST_VERSION, migrate } from "./migrations.ts";

const log = createLogger("serialize");

/** Produce the canonical stored text for a document (trailing newline). */
export function serialize(snapshot: Snapshot): string {
  return (
    JSON.stringify({ version: LATEST_VERSION, ...snapshot }, null, 2) + "\n"
  );
}

function isNote(value: unknown): value is Note {
  if (!value || typeof value !== "object") return false;
  const n = value as Record<string, unknown>;
  return (
    typeof n.id === "string" &&
    typeof n.body === "string" &&
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
  const doc = migrated as Partial<Snapshot>;
  const notes = Array.isArray(doc.notes) ? doc.notes.filter(isNote) : [];
  return { notes };
}
