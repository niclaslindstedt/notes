// Forward-only migration chain for the persisted document. The stored JSON
// carries a top-level numeric `version`; each entry in the table migrates
// from version `N` to `N+1`. Once a migration ships it must never be removed
// or rewritten — documents in the wild still depend on it to upgrade cleanly.
//
// To add a new version: bump `LATEST_VERSION`, add the next step to the
// table below, and (if the in-memory `Snapshot` shape changed) update
// `src/domain/note.ts` in the same commit.
//
// The `Snapshot` domain type itself stays version-free — versioning is a
// property of the bytes at rest, so it lives entirely here and in
// `./serialize.ts`. `domain/` never sees a `version` field.

import { createLogger } from "../dev/logger.ts";

const log = createLogger("migrate");

export type Versioned = { version: number; [key: string]: unknown };

export type MigrationStep = (doc: Versioned) => Versioned;

export type MigrationTable = Record<number, MigrationStep>;

// Typed as a literal so `serialize.ts` can stamp the same constant onto
// every freshly-written document. Bump this and add a step below in the same
// commit when the persisted shape changes.
export const LATEST_VERSION = 2 as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const migrations: MigrationTable = {
  // v0 → v1: the bootstrap step. Documents written before versioning existed
  // (a bare `{ notes }`, the shape the original localStorage backend wrote
  // under `notes/v1`) read as version 0; this normalises them by guaranteeing
  // the `notes` array is present so a partially-written legacy file still
  // upgrades cleanly.
  0: (doc) => ({
    ...doc,
    version: 1,
    notes: Array.isArray(doc.notes) ? doc.notes : [],
  }),
  // v1 → v2: the title became its own field. Before this, a note's title was
  // its first non-empty body line; lift that line into a new `title` field and
  // drop it from the body so existing notes look unchanged but the title is
  // now separately editable.
  1: (doc) => ({
    ...doc,
    version: 2,
    notes: (Array.isArray(doc.notes) ? doc.notes : []).map(liftTitle),
  }),
};

// Move a note's first non-empty body line into a `title` field. A note that
// already carries a string `title` is left as-is (idempotent / forward-safe).
function liftTitle(note: unknown): unknown {
  if (!isObj(note)) return note;
  if (typeof note.title === "string") return note;
  const body = typeof note.body === "string" ? note.body : "";
  const lines = body.split("\n");
  const titleIndex = lines.findIndex((line) => line.trim().length > 0);
  if (titleIndex === -1) return { ...note, title: "", body };
  const title = lines[titleIndex]!.trim();
  // Drop the title line, then any blank lines immediately after it, so the
  // remaining body doesn't start with the gap the title used to sit above.
  let rest = titleIndex + 1;
  while (rest < lines.length && lines[rest]!.trim().length === 0) rest += 1;
  return { ...note, title, body: lines.slice(rest).join("\n") };
}

export type MigrationResult = {
  data: Versioned;
  migrated: boolean;
};

// Run a parsed document forward to `LATEST_VERSION`. A document with no
// numeric `version` is treated as version 0 (the pre-versioning shape).
// Throws when the document was written by a newer build than this one, or
// when a step in the chain is missing.
export function migrate(raw: unknown): MigrationResult {
  const doc: Versioned = isObj(raw)
    ? { ...(raw as Record<string, unknown>), version: numericVersion(raw) }
    : { version: 0 };

  if (doc.version > LATEST_VERSION) {
    throw new Error(
      `Data was created by a newer version of the app (v${doc.version}); ` +
        `this build supports up to v${LATEST_VERSION}.`,
    );
  }

  let current = doc;
  let migrated = false;
  while (current.version < LATEST_VERSION) {
    const step = migrations[current.version];
    if (!step) {
      throw new Error(
        `No migration registered from v${current.version} to v${current.version + 1}.`,
      );
    }
    current = step(current);
    migrated = true;
  }
  if (migrated) {
    log.info(`migrated v${doc.version} → v${current.version}`);
  }
  return { data: current, migrated };
}

// Pre-versioning documents have no `version` field — read those as 0. A
// present-but-non-numeric `version` is also coerced to 0 so a corrupt header
// re-runs the chain from the start rather than throwing.
function numericVersion(raw: unknown): number {
  if (isObj(raw) && typeof raw.version === "number") return raw.version;
  return 0;
}
