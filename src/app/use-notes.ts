// The notes store as a hook: projects the persistence engine
// (`use-notes-sync`) into the small mutation API the UI binds to. The sync
// engine owns the active `StorageAdapter` — localStorage, a local folder, or
// a cloud backend — and the debounced-save / conflict / offline machinery;
// this hook only translates "create / edit / delete a note" into a whole-
// document `Snapshot` swap, records each onto the undo timeline, and hands
// the sync state back up for the header indicator and the unlock / conflict
// surfaces.

import { useCallback, useMemo, useRef } from "react";

import { unlock } from "../achievements/index.ts";
import { type Attachment, withAttachment } from "../domain/attachment.ts";
import {
  archivedNotes,
  createNote,
  editNote,
  isBlank,
  noteTitle,
  retitleNote,
  setArchived,
  sortByUpdated,
  type Note,
  type SaveFormatting,
  type Snapshot,
} from "../domain/note.ts";
import { importedNote } from "../domain/import.ts";
import type { StorageAdapter } from "../storage/adapter.ts";
import { useNotesSync, type NotesSync } from "./use-notes-sync.ts";
import { useUndoRedo } from "./use-undo-redo.ts";

export type NotesStore = {
  // Most-recently-edited first, with blank (never-typed) notes hidden — the
  // list view binds to this.
  notes: Note[];
  // The full set including blank notes, so the editor can resolve a
  // freshly-created note that isn't in `notes` yet.
  allNotes: Note[];
  // Archived notes, most-recently-edited first — what the archive view lists.
  archived: Note[];
  create: (title?: string) => string;
  // Import dropped markdown files as notes — each file's name (sans extension)
  // becomes the title and its contents the body. Lands them in one undo step
  // and returns how many were added.
  importFiles: (files: readonly { name: string; text: string }[]) => number;
  update: (id: string, body: string) => void;
  /** Attach a pasted / dropped file (its bytes) to a note. */
  attach: (id: string, attachment: Attachment) => void;
  retitle: (id: string, title: string) => void;
  remove: (id: string) => void;
  /** Move a note to the archive (hidden from the overview, not destroyed). */
  archive: (id: string) => void;
  /** Bring an archived note back into the overview. */
  restore: (id: string) => void;
  /** Revert the most recent recorded edit (create / delete / edit session). */
  undo: () => void;
  /** Re-apply the most recently undone edit. */
  redo: () => void;
  /** Whether there is a recorded edit to revert. */
  canUndo: boolean;
  /** Whether there is an undone edit to re-apply. */
  canRedo: boolean;
  // The persistence engine's live state — save status, conflict, offline —
  // for the header sync indicator and the conflict surface.
  sync: NotesSync;
};

export function useNotes(
  adapter: StorageAdapter,
  formatting?: SaveFormatting,
): NotesStore {
  // The undo timeline is built after the sync engine (it needs the engine's
  // `setDoc` / `scheduleSave` to apply a stepped-to snapshot), but the
  // engine's load / reload / conflict-adopt paths must reset that timeline.
  // Break the cycle with a ref the engine reads and the timeline fills once
  // it exists.
  const resetHistory = useRef<(seed: Snapshot) => void>(() => {});

  const sync = useNotesSync({ active: adapter, resetHistory, formatting });
  const notes = sync.doc.notes;

  // Latest document, read from the mutation callbacks so a rapid
  // create-then-type doesn't base its edit on a stale render's list.
  const docRef = useRef<Snapshot>(sync.doc);
  docRef.current = sync.doc;

  // Apply a snapshot stepped to off the undo / redo timeline: swap the visible
  // document and persist it so the reverted state survives a reload, exactly
  // as a normal edit would.
  const applyHistorySnapshot = useCallback(
    (next: Snapshot) => {
      sync.setDoc(next);
      sync.scheduleSave(next);
    },
    [sync],
  );

  const {
    record,
    reset,
    undo: undoTimeline,
    redo: redoTimeline,
    canUndo,
    canRedo,
  } = useUndoRedo({ initialSeed: sync.doc, setData: applyHistorySnapshot });
  resetHistory.current = reset;

  // Apply a producer over the latest snapshot, render it immediately, queue
  // the debounced save, and record the result on the undo timeline. The
  // single seam every mutation runs through. `mergeKey` coalesces a run of
  // continuous edits (typing in one note) into a single undo step.
  const commit = useCallback(
    (
      producer: (prev: Note[]) => Note[],
      label: string,
      mergeKey: string | null = null,
    ): void => {
      const next: Snapshot = { notes: producer(docRef.current.notes) };
      docRef.current = next;
      sync.setDoc(next);
      sync.scheduleSave(next);
      record(next, label, mergeKey);
    },
    [sync, record],
  );

  // A new note opens with the title the caller supplies — the default-title
  // scheme stamps one in (date & time, or the next "Note N"); an empty title
  // leaves the note blank until it's typed into.
  const create = useCallback(
    (title = ""): string => {
      const note = { ...createNote(), title };
      commit((prev) => [note, ...prev], "New note");
      return note.id;
    },
    [commit],
  );

  // Import a batch of dropped files as new notes in one undo step, newest
  // first so they sit at the top of the list (like a freshly created note).
  const importFiles = useCallback(
    (files: readonly { name: string; text: string }[]): number => {
      const fresh = files.map((f) => importedNote(f.name, f.text));
      if (fresh.length === 0) return 0;
      const label =
        fresh.length === 1
          ? `Imported note “${noteTitle(fresh[0]!)}”`
          : `Imported ${fresh.length} notes`;
      commit((prev) => [...fresh, ...prev], label);
      return fresh.length;
    },
    [commit],
  );

  const update = useCallback(
    (id: string, body: string): void => {
      const existing = docRef.current.notes.find((n) => n.id === id);
      const title = existing ? noteTitle(existing) : "note";
      commit(
        (prev) => prev.map((n) => (n.id === id ? editNote(n, body) : n)),
        `Edited note “${title}”`,
        `edit:${id}`,
      );
    },
    [commit],
  );

  // Attach a pasted / dropped file to a note. The editor inserts the body
  // reference separately; this only adds the attachment record (its bytes),
  // which the storage layer externalises to a file on the file backends.
  // Coalesced with the body edit's undo step so one paste is one undo.
  const attach = useCallback(
    (id: string, attachment: Attachment): void => {
      commit(
        (prev) =>
          prev.map((n) =>
            n.id === id
              ? {
                  ...n,
                  attachments: withAttachment(n.attachments, attachment),
                  updatedAt: Date.now(),
                }
              : n,
          ),
        "Attached a file",
        `edit:${id}`,
      );
    },
    [commit],
  );

  const retitle = useCallback(
    (id: string, title: string): void => {
      commit(
        (prev) => prev.map((n) => (n.id === id ? retitleNote(n, title) : n)),
        `Renamed note “${title.trim() || "Untitled note"}”`,
        `retitle:${id}`,
      );
    },
    [commit],
  );

  const remove = useCallback(
    (id: string): void => {
      const target = docRef.current.notes.find((n) => n.id === id);
      const title = target ? noteTitle(target) : "note";
      commit(
        (prev) => prev.filter((n) => n.id !== id),
        `Deleted note “${title}”`,
      );
    },
    [commit],
  );

  const archive = useCallback(
    (id: string): void => {
      const target = docRef.current.notes.find((n) => n.id === id);
      const title = target ? noteTitle(target) : "note";
      commit(
        (prev) => prev.map((n) => (n.id === id ? setArchived(n, true) : n)),
        `Archived note “${title}”`,
      );
    },
    [commit],
  );

  const restore = useCallback(
    (id: string): void => {
      const target = docRef.current.notes.find((n) => n.id === id);
      const title = target ? noteTitle(target) : "note";
      commit(
        (prev) => prev.map((n) => (n.id === id ? setArchived(n, false) : n)),
        `Restored note “${title}”`,
      );
    },
    [commit],
  );

  const undo = useCallback(() => {
    undoTimeline();
    unlock("secondThoughts");
  }, [undoTimeline]);

  const redo = useCallback(() => {
    redoTimeline();
  }, [redoTimeline]);

  // List view always shows most-recently-edited first, with blank notes
  // (a freshly created, never-typed note) and archived notes filtered out —
  // blanks vanish on their own if abandoned; archived notes live in the
  // archive view instead.
  const visible = useMemo(
    () => sortByUpdated(notes.filter((n) => !isBlank(n) && !n.archived)),
    [notes],
  );

  // Archived notes for the archive view, newest-edited first.
  const archivedList = useMemo(
    () => sortByUpdated(archivedNotes(notes)),
    [notes],
  );

  return {
    notes: visible,
    allNotes: notes,
    archived: archivedList,
    create,
    importFiles,
    update,
    attach,
    retitle,
    remove,
    archive,
    restore,
    undo,
    redo,
    canUndo,
    canRedo,
    sync,
  };
}
