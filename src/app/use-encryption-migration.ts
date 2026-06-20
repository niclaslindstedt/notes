// React owner for the background encryption migration. When encryption is on
// (and the backend stores files), it seeds the per-note status from the adapter
// and drives `runEncryptionMigration` over the current notes, updating the
// status map as each note is sealed so the green lock fills in live. The status
// map it returns is what the note list and side menu read to draw the lock.

import { useEffect, useRef, useState } from "react";

import type { Note } from "../domain/note.ts";
import { createLogger } from "../dev/logger.ts";
import { runEncryptionMigration } from "../storage/encryption-migration.ts";

const log = createLogger("migration");

export type NoteEncStatus = "encrypted" | "pending";

type Options = {
  /** Encryption on, a file/cloud backend, and unlocked. */
  enabled: boolean;
  /** The notes to converge to encrypted at rest. */
  notes: readonly Note[];
  /** The adapter's current per-note status (seed + resume hint). */
  getStatus?: () => Map<string, NoteEncStatus>;
  /** Convert one note to encrypted at rest (idempotent). */
  migrateNote?: (note: Note) => Promise<boolean>;
  /** Upgrade a legacy whole-document blob to per-file form (one-time). */
  splitLegacyBlob?: () => Promise<boolean>;
};

export function useEncryptionMigration({
  enabled,
  notes,
  getStatus,
  migrateNote,
  splitLegacyBlob,
}: Options): Map<string, NoteEncStatus> {
  const [status, setStatus] = useState<Map<string, NoteEncStatus>>(new Map());
  const runningRef = useRef(false);
  // A stable signature so the effect re-runs when the note set changes (a new
  // note to encrypt) but not on every render.
  const notesKey = notes
    .map((n) => n.id)
    .sort()
    .join(",");

  useEffect(() => {
    if (!enabled || !migrateNote) {
      setStatus(new Map());
      return;
    }
    setStatus(new Map(getStatus?.() ?? new Map()));
    if (runningRef.current) return;
    runningRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        // First upgrade a legacy whole-document blob (existing users) to the
        // per-file form, then seal any remaining plaintext notes.
        if (splitLegacyBlob) {
          const split = await splitLegacyBlob();
          if (split && !cancelled)
            setStatus(new Map(getStatus?.() ?? new Map()));
        }
        await runEncryptionMigration({
          notes,
          migrateNote,
          shouldStop: () => cancelled,
          onProgress: (id) =>
            setStatus((prev) => new Map(prev).set(id, "encrypted")),
        });
      } catch (err) {
        log.warn("encryption migration aborted", err);
      } finally {
        runningRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, notesKey, migrateNote, splitLegacyBlob]);

  return status;
}
