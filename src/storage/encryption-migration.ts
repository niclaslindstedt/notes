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
//
// Failures are triaged, not blanket-aborted, so a flaky link can't strand a
// folder half-converted (some notes sealed, some not):
//
//   - A `RateLimitError` (429) waits out the cooldown — unbounded, since the
//     backend is healthy and giving up would only leave work undone.
//   - A *transient* error (a dropped fetch / "Load failed", a 5xx) retries the
//     SAME note with growing backoff up to `maxTransientRetries`, then gives
//     up so the run doesn't spin forever offline. The idempotent converter
//     resumes from where it left off on the next run (the hook re-runs when
//     connectivity returns).
//   - A *permanent* error (auth expired, a write conflict) propagates
//     immediately: waiting can't fix it, and its dedicated UI (reconnect /
//     resolve) must take over.

import { RateLimitError } from "./adapter.ts";
import type { NoteConversionProgress, NoteConversionStep } from "./adapter.ts";
import { backoffDelayMs, isRetryableSaveError } from "./save-retry.ts";
import type { Note } from "../domain/note.ts";

const DEFAULT_PACE_MS = 150;

// How many times a single note's conversion is retried through a transient
// failure before the run gives up (and resumes on the next mount). The first
// attempt isn't a retry, so the worst case is 1 + this many `convert` calls per
// note. Kept independent of the save path's budget so the cadence can be tuned
// separately.
const DEFAULT_MAX_TRANSIENT_RETRIES = 5;

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
  /**
   * Fires before each backoff sleep that follows a transient failure, so the
   * caller can surface "retrying…" instead of a silent stall. `attempt` is
   * 1-based (the first retry is 1); `delayMs` is the wait that follows.
   */
  onRetry?: (
    note: Note,
    err: unknown,
    attempt: number,
    delayMs: number,
  ) => void;
  /** Stop early (e.g. the backend/passphrase changed) between notes. */
  shouldStop?: () => boolean;
  /** Gap between notes so a big conversion doesn't burst the cloud API. */
  paceMs?: number;
  /** Transient-failure retry budget per note (default 5). */
  maxTransientRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<void> {
  const { notes, convert, onStep, onNoteDone, onRetry, shouldStop } = opts;
  const paceMs = opts.paceMs ?? DEFAULT_PACE_MS;
  const maxTransientRetries =
    opts.maxTransientRetries ?? DEFAULT_MAX_TRANSIENT_RETRIES;
  const sleep = opts.sleep ?? defaultSleep;
  let throttles = 0;
  for (const note of notes) {
    if (shouldStop?.()) return;
    let transientRetries = 0;
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
        // A flip/unmount during the failed `convert` (or its backoff): bail
        // rather than retry into a backend that's already been swapped out.
        if (shouldStop?.()) return;
        if (err instanceof RateLimitError) {
          const wait = Math.max(err.retryAfterMs, backoffDelayMs(throttles));
          throttles += 1;
          await sleep(wait);
          continue;
        }
        // Permanent (auth/conflict) or out of retries → abort the run; the
        // idempotent steps already done survive for the next resume.
        if (
          !isRetryableSaveError(err) ||
          transientRetries >= maxTransientRetries
        ) {
          throw err;
        }
        const wait = backoffDelayMs(transientRetries);
        transientRetries += 1;
        onRetry?.(note, err, transientRetries, wait);
        await sleep(wait);
        if (shouldStop?.()) return;
      }
    }
    if (paceMs > 0) await sleep(paceMs);
  }
}
