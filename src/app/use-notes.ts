// The notes store as a hook: projects the persistence engine
// (`use-notes-sync`) into the small mutation API the UI binds to. The sync
// engine owns the active `StorageAdapter` — localStorage, a local folder, or
// a cloud backend — and the debounced-save / conflict / offline machinery;
// this hook only translates "create / edit / delete a note" into a whole-
// document `Snapshot` swap and hands the sync state back up for the header
// indicator and the unlock / conflict surfaces.

import { useCallback, useMemo, useRef } from "react";

import {
  createNote,
  editNote,
  isBlank,
  sortByUpdated,
  type Note,
  type Snapshot,
} from "../domain/note.ts";
import type { StorageAdapter } from "../storage/adapter.ts";
import { useNotesSync, type NotesSync } from "./use-notes-sync.ts";

export type NotesStore = {
  // Most-recently-edited first, with blank (never-typed) notes hidden — the
  // list view binds to this.
  notes: Note[];
  // The full set including blank notes, so the editor can resolve a
  // freshly-created note that isn't in `notes` yet.
  allNotes: Note[];
  create: () => string;
  update: (id: string, body: string) => void;
  remove: (id: string) => void;
  // The persistence engine's live state — save status, conflict, offline —
  // for the header sync indicator and the conflict surface.
  sync: NotesSync;
};

export function useNotes(adapter: StorageAdapter): NotesStore {
  const sync = useNotesSync({ active: adapter });
  const notes = sync.doc.notes;

  // Latest document, read from the mutation callbacks so a rapid
  // create-then-type doesn't base its edit on a stale render's list.
  const docRef = useRef<Snapshot>(sync.doc);
  docRef.current = sync.doc;

  // Apply a producer over the latest snapshot, render it immediately, and
  // queue the debounced save. The single seam every mutation runs through.
  const commit = useCallback(
    (producer: (prev: Note[]) => Note[]): void => {
      const next: Snapshot = { notes: producer(docRef.current.notes) };
      docRef.current = next;
      sync.setDoc(next);
      sync.scheduleSave(next);
    },
    [sync],
  );

  const create = useCallback((): string => {
    const note = createNote();
    commit((prev) => [note, ...prev]);
    return note.id;
  }, [commit]);

  const update = useCallback(
    (id: string, body: string): void => {
      commit((prev) => prev.map((n) => (n.id === id ? editNote(n, body) : n)));
    },
    [commit],
  );

  const remove = useCallback(
    (id: string): void => {
      commit((prev) => prev.filter((n) => n.id !== id));
    },
    [commit],
  );

  // List view always shows most-recently-edited first, with blank notes
  // (a freshly created, never-typed note) filtered out so they don't
  // accumulate — they vanish on their own if abandoned.
  const visible = useMemo(
    () => sortByUpdated(notes.filter((n) => !isBlank(n))),
    [notes],
  );

  return { notes: visible, allNotes: notes, create, update, remove, sync };
}
