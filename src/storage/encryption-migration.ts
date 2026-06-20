// Paced, resumable driver that converts notes between their plaintext and
// encrypted per-file forms one at a time. It is direction-agnostic: turning
// encryption on hands it `migrateNote` (plaintext → encrypted), turning it off
// hands it `demigrateNote` (encrypted → plaintext). Either way the mode the app
// reports flips so the document stays readable (the encrypted load merges any
// not-yet-converted remnant), and this runs in the background to convert each
// note and its attachments, so the user watches the green lock fill in — or
// drain away — note-by-note.
//
// One note at a time with a small pacing gap keeps a 500-note Dropbox
// conversion from bursting the API; a `RateLimitError` waits out the cooldown
// (reusing the save path's backoff) and resumes. Each `convert` is idempotent,
// so an interrupted run simply finishes next time — nothing is lost.

import { RateLimitError } from "./adapter.ts";
import type { NoteConversionProgress, NoteConversionStep } from "./adapter.ts";
import { backoffDelayMs } from "./save-retry.ts";
import type { Note } from "../domain/note.ts";

const DEFAULT_PACE_MS = 150;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function runEncryptionMigration(opts: {
  notes: readonly Note[];
  /** Convert one note (encrypt or decrypt at rest), idempotent. */
  convert: (note: Note, onStep?: NoteConversionProgress) => Promise<boolean>;
  /** Fires for each fine-grained step (a note's attachment, then the note). */
  onStep?: (note: Note, step: NoteConversionStep) => void;
  /** Fires once per note after it is fully converted. */
  onNoteDone?: (note: Note, did: boolean) => void;
  /** Stop early (e.g. the backend/passphrase changed) between notes. */
  shouldStop?: () => boolean;
  /** Gap between notes so a big conversion doesn't burst the cloud API. */
  paceMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<void> {
  const { notes, convert, onStep, onNoteDone, shouldStop } = opts;
  const paceMs = opts.paceMs ?? DEFAULT_PACE_MS;
  const sleep = opts.sleep ?? defaultSleep;
  let throttles = 0;
  for (const note of notes) {
    if (shouldStop?.()) return;
    // Retry only the rate-limit case here; other errors abort the run (the next
    // mount resumes from where the idempotent steps leave the folder).
    for (;;) {
      try {
        const did = await convert(note, (step) => {
          if (shouldStop?.()) return;
          onStep?.(note, step);
        });
        onNoteDone?.(note, did);
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
