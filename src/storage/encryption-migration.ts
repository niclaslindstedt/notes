// Paced, resumable driver that converts notes from plaintext to their encrypted
// per-file form one at a time. Turning encryption on flips the mode immediately
// (the document stays readable — the encrypted load merges any not-yet-migrated
// plaintext remnants), and this runs in the background to seal each note and its
// attachments, so the user watches the green lock fill in note-by-note.
//
// One note at a time with a small pacing gap keeps a 500-note Dropbox migration
// from bursting the API; a `RateLimitError` waits out the cooldown (reusing the
// save path's backoff) and resumes. Each `migrateNote` is idempotent, so an
// interrupted run simply finishes next time — nothing is lost.

import { RateLimitError } from "./adapter.ts";
import { backoffDelayMs } from "./save-retry.ts";
import type { Note } from "../domain/note.ts";

export type MigrationProgress = (noteId: string) => void;

const DEFAULT_PACE_MS = 150;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function runEncryptionMigration(opts: {
  notes: readonly Note[];
  migrateNote: (note: Note) => Promise<boolean>;
  onProgress?: MigrationProgress;
  /** Stop early (e.g. the backend/passphrase changed) between notes. */
  shouldStop?: () => boolean;
  /** Gap between notes so a big migration doesn't burst the cloud API. */
  paceMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<void> {
  const { notes, migrateNote, onProgress, shouldStop } = opts;
  const paceMs = opts.paceMs ?? DEFAULT_PACE_MS;
  const sleep = opts.sleep ?? defaultSleep;
  let throttles = 0;
  for (const note of notes) {
    if (shouldStop?.()) return;
    // Retry only the rate-limit case here; other errors abort the run (the next
    // mount resumes from where the idempotent steps leave the folder).
    for (;;) {
      try {
        await migrateNote(note);
        onProgress?.(note.id);
        throttles = 0;
        break;
      } catch (err) {
        if (err instanceof RateLimitError) {
          const wait = Math.max(err.retryAfterMs, backoffDelayMs(throttles));
          throttles += 1;
          await sleep(wait);
          continue;
        }
        throw err;
      }
    }
    if (paceMs > 0) await sleep(paceMs);
  }
}
