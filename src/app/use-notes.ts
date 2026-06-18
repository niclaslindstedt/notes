// The notes store as a hook: holds the in-memory list, persists every
// change to `localStorage`, and exposes the mutations the UI needs. This is
// the seam the richer checklist-style sync layer (undo/redo, cloud
// backends, conflict resolution) can grow into later via `copy-feature` —
// the component tree only ever talks to this hook, not to storage directly.

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createNote,
  editNote,
  isBlank,
  sortByUpdated,
  type Note,
} from "../domain/note.ts";
import { loadNotes, saveNotes } from "../storage/local.ts";

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
};

export function useNotes(): NotesStore {
  const [notes, setNotes] = useState<Note[]>(() => loadNotes());

  // Persist whenever the list changes. Cheap enough at this scale to write
  // the whole snapshot; a future backend can debounce or diff here.
  useEffect(() => {
    saveNotes(notes);
  }, [notes]);

  const create = useCallback((): string => {
    const note = createNote();
    setNotes((prev) => [note, ...prev]);
    return note.id;
  }, []);

  const update = useCallback((id: string, body: string): void => {
    setNotes((prev) => prev.map((n) => (n.id === id ? editNote(n, body) : n)));
  }, []);

  const remove = useCallback((id: string): void => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // List view always shows most-recently-edited first, with blank notes
  // (a freshly created, never-typed note) filtered out of the list so they
  // don't accumulate — they vanish on their own if abandoned.
  const visible = useMemo(
    () => sortByUpdated(notes.filter((n) => !isBlank(n))),
    [notes],
  );

  return { notes: visible, allNotes: notes, create, update, remove };
}
