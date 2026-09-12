// Erasing an attachment from a note is two decisions, not one.
//
// Deleting an `![](attachments/…)` / `[file](attachments/…)` reference out of
// the body is an edit of the text, and it takes effect immediately — the
// thumbnail or chip stops rendering. What it deliberately does *not* do is
// reach into the user's Dropbox / Drive / Nextcloud / notes folder and delete
// the file, because that file is theirs and a backspace is not consent. So the
// app asks: **"Remove attachment from <backend> too?"**
//
// Answering **no** is the interesting half. The attachment record stays on the
// note (unreferenced — see `Note.attachments`), the file stays on the backend,
// and pasting the reference back into the body resolves it again on the spot,
// bytes and all. Answering **yes** drops the record, and the next save's
// reconcile pass takes the file off the backend.
//
// Two details matter as much as the question itself:
//
//   - **It waits.** A reference is erased character by character; the moment
//     the closing `)` goes the reference stops matching, and popping a modal
//     over someone mid-backspace would be intolerable. The question is held
//     until the note has been quiet for `SETTLE_MS`, and is re-checked against
//     the body as it stands *then* — so erase-and-retype, or an undo, simply
//     never asks.
//   - **It only asks where there is a file.** The local "This device" backend
//     stores no attachment files, so there is nothing to keep and nothing to
//     ask about; the record is dropped straight away, as it always was.

import { useCallback, useEffect, useRef, useState } from "react";

import { unlock } from "../achievements/bus.ts";
import {
  type Attachment,
  unreferencedAttachments,
} from "../domain/attachment.ts";
import type { Note } from "../domain/note.ts";

// How long a note must go without a body edit before the erased attachments
// are worth asking about. Long enough to sit out a deliberate select-and-
// retype, short enough that the question still feels like a reply to what was
// just done.
const SETTLE_MS = 1500;

/** One note's worth of erased attachments, waiting on an answer. */
export type AttachmentErasurePrompt = {
  noteId: string;
  /** The attachments whose references were erased, in note order. */
  attachments: Attachment[];
};

export type AttachmentErasure = {
  /** The question to put to the user, or null when there is nothing to ask. */
  prompt: AttachmentErasurePrompt | null;
  /**
   * Note a body edit: `before` is the note as it stood, `body` what it became.
   * Records any attachment the edit stopped referencing as a candidate; the
   * question itself is raised once the note falls quiet.
   */
  observe: (before: Note, body: string) => void;
  /** Answer the open question — `true` removes the files, `false` keeps them. */
  resolve: (remove: boolean) => void;
  /**
   * Drop every pending candidate and question for a note (it was deleted), or
   * for all notes when called with no id (the document was reseeded).
   */
  forget: (noteId?: string) => void;
};

export function useAttachmentErasure(opts: {
  /** Whether the active backend stores attachments as files of its own. */
  stores: boolean;
  /** The note as it stands right now, by id. */
  noteById: (id: string) => Note | undefined;
  /** Take the named attachments off a note (and so off the backend). */
  prune: (noteId: string, filenames: readonly string[]) => void;
}): AttachmentErasure {
  const { stores, noteById, prune } = opts;
  // Read the latest callbacks from the settle timer without re-arming it
  // whenever the caller re-renders with fresh closures.
  const latest = useRef({ stores, noteById, prune });
  latest.current = { stores, noteById, prune };

  // noteId → the filenames whose references this session's edits erased, still
  // waiting for the note to fall quiet.
  const candidates = useRef<Map<string, Set<string>>>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [queue, setQueue] = useState<AttachmentErasurePrompt[]>([]);
  // The queue as the callbacks see it, so answering reads the open question
  // without a state updater having to do the pruning (a side effect in an
  // updater would run twice under StrictMode's double invoke).
  const queueRef = useRef<AttachmentErasurePrompt[]>(queue);
  queueRef.current = queue;

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  // The settle pass: re-derive each candidate against the note as it stands
  // now, so anything the user put back in the meantime asks nothing.
  const settle = useCallback(() => {
    timer.current = null;
    const pending = candidates.current;
    candidates.current = new Map();
    const raised: AttachmentErasurePrompt[] = [];
    for (const [noteId, filenames] of pending) {
      const note = latest.current.noteById(noteId);
      if (!note || note.body === undefined) continue;
      const erased = unreferencedAttachments(
        note.body,
        note.attachments,
      ).filter((a) => filenames.has(a.filename));
      if (erased.length === 0) continue;
      if (!latest.current.stores) {
        // No file behind the record — nothing to keep, so nothing to ask.
        latest.current.prune(
          noteId,
          erased.map((a) => a.filename),
        );
        continue;
      }
      raised.push({ noteId, attachments: erased });
    }
    if (raised.length > 0) setQueue((q) => [...q, ...raised]);
  }, []);

  const observe = useCallback(
    (before: Note, body: string): void => {
      const attachments = before.attachments;
      if (!attachments || attachments.length === 0) return;
      if (before.body === undefined) return;
      // Only what *this* edit erased. An attachment the user already chose to
      // keep is unreferenced for good, and must not re-ask on every keystroke.
      const already = new Set(
        unreferencedAttachments(before.body, attachments).map(
          (a) => a.filename,
        ),
      );
      const erased = unreferencedAttachments(body, attachments).filter(
        (a) => !already.has(a.filename),
      );
      const waiting = candidates.current.get(before.id);
      if (erased.length === 0 && !waiting) return;
      if (erased.length > 0) {
        const set = waiting ?? new Set<string>();
        for (const a of erased) set.add(a.filename);
        candidates.current.set(before.id, set);
      }
      // Any edit to a note with a question pending restarts its quiet period —
      // the answer is checked against the text the user actually settles on.
      clearTimer();
      timer.current = setTimeout(settle, SETTLE_MS);
    },
    [clearTimer, settle],
  );

  const resolve = useCallback((remove: boolean): void => {
    const head = queueRef.current[0];
    if (!head) return;
    if (remove) {
      // Re-check against the note as it stands: an undo between the question
      // and the answer must not delete a file that is referenced again.
      const note = latest.current.noteById(head.noteId);
      const body = note?.body;
      const gone =
        body === undefined
          ? head.attachments
          : unreferencedAttachments(body, note?.attachments).filter((a) =>
              head.attachments.some((h) => h.filename === a.filename),
            );
      if (gone.length > 0) {
        latest.current.prune(
          head.noteId,
          gone.map((a) => a.filename),
        );
      }
    } else {
      unlock("safekeeping");
    }
    setQueue((q) => (q[0] === head ? q.slice(1) : q));
  }, []);

  const forget = useCallback(
    (noteId?: string): void => {
      if (noteId === undefined) {
        candidates.current.clear();
        clearTimer();
        setQueue((q) => (q.length === 0 ? q : []));
        return;
      }
      candidates.current.delete(noteId);
      setQueue((q) =>
        q.some((p) => p.noteId === noteId)
          ? q.filter((p) => p.noteId !== noteId)
          : q,
      );
    },
    [clearTimer],
  );

  return { prompt: queue[0] ?? null, observe, resolve, forget };
}
