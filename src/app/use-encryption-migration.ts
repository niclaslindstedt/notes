// React owner for the background encryption conversion. It is bidirectional:
// when the user turns encryption on it seals each note (and its attachments)
// one at a time; when they turn it off it does the exact reverse, decrypting
// each note back to plaintext. Either way the mode flips immediately and this
// drives the paced per-note conversion in the background, so the settings modal
// can be closed and the work keeps going — the green lock filling in (or
// draining away) note-by-note is the visible surface.
//
// It returns two things: the per-note status map the note list and side menu
// read to draw the lock, and a live `conversion` snapshot (which note / which
// attachment it's on, how far along, any error) the storage settings flash so
// the user can watch — even if it all goes by in a blur.

import { useCallback, useEffect, useRef, useState } from "react";

import { unlock } from "../achievements/index.ts";
import { noteTitle, type Note } from "../domain/note.ts";
import { createLogger } from "../dev/logger.ts";
import { useT } from "../i18n/index.ts";
import type { NoteConversionStep } from "../storage/adapter.ts";
import { runEncryptionMigration } from "../storage/encryption-migration.ts";
import type {
  EncryptionConversionState,
  EncryptionLogEntry,
} from "../ui/settings/EncryptionLogModal.tsx";

const log = createLogger("migration");

export type NoteEncStatus = "encrypted" | "pending";

export type { EncryptionConversionState };

const IDLE: EncryptionConversionState = {
  busy: false,
  direction: null,
  message: null,
  done: 0,
  total: 0,
  error: null,
  log: [],
};

// Keep the failure log bounded — a 500-note conversion would otherwise grow an
// entry per attachment per note. The tail is what matters when something breaks.
const MAX_LOG_ENTRIES = 200;

type Options = {
  /** Encryption on, a file/cloud backend, and unlocked. */
  enabled: boolean;
  /** Turning encryption off: run the reverse (decrypt) conversion instead. */
  disabling: boolean;
  /** The notes to converge to the target representation. */
  notes: readonly Note[];
  /** The adapter's current per-note status (seed + resume hint). */
  getStatus?: () => Map<string, NoteEncStatus>;
  /** Convert one note to encrypted at rest (idempotent). */
  migrateNote?: (
    note: Note,
    onStep?: (step: NoteConversionStep) => void,
  ) => Promise<boolean>;
  /** Convert one note back to plaintext at rest (idempotent). */
  demigrateNote?: (
    note: Note,
    onStep?: (step: NoteConversionStep) => void,
  ) => Promise<boolean>;
  /** Upgrade a legacy whole-document blob to per-file form (one-time). */
  splitLegacyBlob?: () => Promise<boolean>;
  /** Fired once the reverse conversion has finished, to drop the passphrase. */
  onDisableComplete?: () => void;
};

export type UseEncryptionMigration = {
  status: Map<string, NoteEncStatus>;
  conversion: EncryptionConversionState;
};

export function useEncryptionMigration({
  enabled,
  disabling,
  notes,
  getStatus,
  migrateNote,
  demigrateNote,
  splitLegacyBlob,
  onDisableComplete,
}: Options): UseEncryptionMigration {
  const t = useT();
  const [status, setStatus] = useState<Map<string, NoteEncStatus>>(new Map());
  const [conversion, setConversion] = useState<EncryptionConversionState>(IDLE);
  // A monotonically increasing token per effect run: a loop bails the moment its
  // token is no longer current (the effect re-ran, or the deps changed), which
  // is how a direction flip or an unmount stops the in-flight conversion.
  const runRef = useRef(0);
  // Latest `t` / completion callback, read at call time so a language switch or
  // a new callback identity doesn't restart the conversion mid-flight.
  const tRef = useRef(t);
  tRef.current = t;
  const onDoneRef = useRef(onDisableComplete);
  onDoneRef.current = onDisableComplete;

  // A stable signature so the effect re-runs when the note set changes (a new
  // note to convert) but not on every render.
  const notesKey = notes
    .map((n) => n.id)
    .sort()
    .join(",");

  const messageFor = useCallback(
    (
      direction: "encrypt" | "decrypt",
      note: Note,
      step: NoteConversionStep,
    ) => {
      const title = noteTitle(note);
      const tt = tRef.current;
      if (step.phase === "attachment") {
        return tt(
          direction === "encrypt"
            ? "settings.storage.encryptingAttachment"
            : "settings.storage.decryptingAttachment",
          { filename: step.filename, title },
        );
      }
      return tt(
        direction === "encrypt"
          ? "settings.storage.encryptingNote"
          : "settings.storage.decryptingNote",
        { title },
      );
    },
    [],
  );

  useEffect(() => {
    const convert = disabling ? demigrateNote : migrateNote;
    if (!enabled || !convert) {
      setStatus(new Map());
      setConversion(IDLE);
      return;
    }
    const myRun = ++runRef.current;
    const cancelled = () => runRef.current !== myRun;
    const direction: "encrypt" | "decrypt" = disabling ? "decrypt" : "encrypt";

    setStatus(new Map(getStatus?.() ?? new Map()));
    const total = notes.length;
    setConversion({ ...IDLE, busy: true, direction, total });

    const pushLog = (text: string, level: EncryptionLogEntry["level"]) =>
      setConversion((prev) => {
        const next = [...prev.log, { text, ts: Date.now(), level }];
        if (next.length > MAX_LOG_ENTRIES)
          next.splice(0, next.length - MAX_LOG_ENTRIES);
        return { ...prev, log: next };
      });

    let done = 0;
    void (async () => {
      try {
        // Forward only: upgrade a legacy whole-document blob (existing users) to
        // the per-file form before sealing any remaining plaintext notes.
        if (!disabling && splitLegacyBlob) {
          const split = await splitLegacyBlob();
          if (split && !cancelled())
            setStatus(new Map(getStatus?.() ?? new Map()));
        }
        await runEncryptionMigration({
          notes,
          convert,
          shouldStop: cancelled,
          onStep: (note, step) => {
            if (cancelled()) return;
            const text = messageFor(direction, note, step);
            setConversion((prev) => ({ ...prev, message: text }));
            pushLog(text, "info");
          },
          onNoteDone: (note) => {
            if (cancelled()) return;
            done += 1;
            setStatus((prev) => {
              const m = new Map(prev);
              if (disabling) m.delete(note.id);
              else m.set(note.id, "encrypted");
              return m;
            });
            setConversion((prev) => ({ ...prev, done }));
          },
        });
        if (cancelled()) return;
        if (disabling) {
          // Every note is plaintext again → finalise (drop the passphrase).
          setConversion(IDLE);
          onDoneRef.current?.();
        } else {
          // Every note (and its attachments) now sealed → the milestone. Read
          // the status map once, not once per note — `getStatus` clones it on
          // each call, so calling it inside `.every()` was O(notes²).
          const finalStatus = getStatus?.();
          if (
            total > 0 &&
            finalStatus &&
            notes.every((n) => finalStatus.get(n.id) === "encrypted")
          ) {
            unlock("fortKnox");
          }
          setConversion(IDLE);
        }
      } catch (err) {
        if (cancelled()) return;
        log.warn("encryption conversion aborted", err);
        const text = err instanceof Error ? err.message : String(err);
        pushLog(text, "error");
        setConversion((prev) => ({
          ...prev,
          busy: false,
          message: null,
          error: text,
        }));
      }
    })();
    return () => {
      // Invalidate this run so any in-flight loop bails at its next checkpoint.
      runRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    disabling,
    notesKey,
    migrateNote,
    demigrateNote,
    splitLegacyBlob,
  ]);

  return { status, conversion };
}
