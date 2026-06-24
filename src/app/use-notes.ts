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
  createFolder as createFolderRecord,
  editNote,
  isBlank,
  noteTitle,
  retitleNote,
  setArchived,
  setNoteFolder,
  sortByUpdated,
  sortFoldersByCreated,
  type Folder,
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
  // The folders defined in the active namespace, in stable creation order.
  // Notes are grouped under these in the side menu and overview.
  folders: Folder[];
  // Open a new note. A `folderId` drops it straight into that folder (used by
  // the per-folder "New note" rows); omitted, it lands ungrouped.
  create: (title?: string, folderId?: string) => string;
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
  /** Move a note into `folderId`, or out of any folder when `null`. */
  moveNote: (id: string, folderId: string | null) => void;
  /** Create a folder and return its id. */
  createFolder: (name: string) => string;
  /** Rename a folder (its id, and the notes in it, stay put). */
  renameFolder: (id: string, name: string) => void;
  /** Delete a folder; its notes survive and fall back to ungrouped. */
  removeFolder: (id: string) => void;
  // Decrypt and load a deferred note's body (the encrypted file/cloud backends
  // render the list from an index with bodies left unloaded). Resolves once the
  // body is in the in-memory document, or immediately when it's already loaded
  // or the backend doesn't defer bodies. The editor calls this when a note is
  // opened so it shows the real text rather than an empty body.
  ensureBody: (id: string) => Promise<void>;
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
  // the debounced save, and record the result on the undo timeline. The single
  // seam every mutation runs through. `mergeKey` coalesces a run of continuous
  // edits (typing in one note) into a single undo step.
  const commitSnapshot = useCallback(
    (
      producer: (prev: Snapshot) => Snapshot,
      label: string,
      mergeKey: string | null = null,
    ): void => {
      const next = producer(docRef.current);
      docRef.current = next;
      sync.setDoc(next);
      sync.scheduleSave(next);
      record(next, label, mergeKey);
    },
    [sync, record],
  );

  // The common case: a producer over just the notes list, preserving the
  // folder registry (and any other snapshot field) untouched.
  const commit = useCallback(
    (
      producer: (prev: Note[]) => Note[],
      label: string,
      mergeKey: string | null = null,
    ): void => {
      commitSnapshot(
        (prev) => ({ ...prev, notes: producer(prev.notes) }),
        label,
        mergeKey,
      );
    },
    [commitSnapshot],
  );

  // Merge a freshly-decrypted body into the on-screen document without bumping
  // `updatedAt` or scheduling a save — loading a body to read it is not an edit.
  // Only fills a note that's still deferred, so it can't stomp a concurrent
  // edit that already put a real body there.
  const mergeBody = useCallback(
    (id: string, body: string): void => {
      const cur = docRef.current;
      const target = cur.notes.find((n) => n.id === id);
      if (!target || target.body !== undefined) return;
      const next: Snapshot = {
        ...cur,
        notes: cur.notes.map((n) =>
          n.id === id ? { ...n, body, preview: undefined } : n,
        ),
      };
      docRef.current = next;
      sync.setDoc(next);
    },
    [sync],
  );

  const ensureBody = useCallback(
    async (id: string): Promise<void> => {
      const note = docRef.current.notes.find((n) => n.id === id);
      if (!note || note.body !== undefined) return;
      if (!adapter.fetchNoteBody) return;
      const body = await adapter.fetchNoteBody(note);
      if (body !== null) mergeBody(id, body);
    },
    [adapter, mergeBody],
  );

  // Run a mutation that rewrites a note's stored form, loading the note's body
  // first when it's deferred. The encrypted save never rewrites a deferred note
  // (its body isn't in memory to seal), so a metadata edit — retitle, archive,
  // move — must promote the note to loaded first, or the change wouldn't reach
  // its `.enc` file. Runs synchronously when the body is already loaded (an
  // already-open note), so it adds no latency in that case.
  const withBody = useCallback(
    (id: string, run: () => void): void => {
      const note = docRef.current.notes.find((n) => n.id === id);
      if (note && note.body === undefined) void ensureBody(id).then(run);
      else run();
    },
    [ensureBody],
  );

  // A new note opens with the title the caller supplies — the default-title
  // scheme stamps one in (date & time, or the next "Note N"); an empty title
  // leaves the note blank until it's typed into.
  const create = useCallback(
    (title = "", folderId?: string): string => {
      const note: Note = { ...createNote(), title };
      if (folderId) note.folderId = folderId;
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
      // An unchanged body is a no-op — don't churn the document, schedule a
      // save, or record an undo step (which would also bump `updatedAt` and
      // jump the note to the top of the list).
      if (existing && existing.body === body) return;
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
      withBody(id, () =>
        commit(
          (prev) => prev.map((n) => (n.id === id ? retitleNote(n, title) : n)),
          `Renamed note “${title.trim() || "Untitled note"}”`,
          `retitle:${id}`,
        ),
      );
    },
    [commit, withBody],
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
      withBody(id, () =>
        commit(
          (prev) => prev.map((n) => (n.id === id ? setArchived(n, true) : n)),
          `Archived note “${title}”`,
        ),
      );
    },
    [commit, withBody],
  );

  const restore = useCallback(
    (id: string): void => {
      const target = docRef.current.notes.find((n) => n.id === id);
      const title = target ? noteTitle(target) : "note";
      withBody(id, () =>
        commit(
          (prev) => prev.map((n) => (n.id === id ? setArchived(n, false) : n)),
          `Restored note “${title}”`,
        ),
      );
    },
    [commit, withBody],
  );

  // Move a note into a folder (or out of every folder when `folderId` is null).
  // Not coalesced with edits — a move is its own undo step.
  const moveNote = useCallback(
    (id: string, folderId: string | null): void => {
      const target = docRef.current.notes.find((n) => n.id === id);
      if (!target) return;
      if ((target.folderId ?? null) === folderId) return;
      const title = noteTitle(target);
      withBody(id, () =>
        commit(
          (prev) =>
            prev.map((n) => (n.id === id ? setNoteFolder(n, folderId) : n)),
          folderId
            ? `Moved note “${title}” to a folder`
            : `Moved note “${title}” out of its folder`,
        ),
      );
    },
    [commit, withBody],
  );

  const createFolder = useCallback(
    (name: string): string => {
      const folder = createFolderRecord(name);
      commitSnapshot(
        (prev) => ({ ...prev, folders: [...(prev.folders ?? []), folder] }),
        `Created folder “${folder.name}”`,
      );
      unlock("organizer");
      return folder.id;
    },
    [commitSnapshot],
  );

  const renameFolder = useCallback(
    (id: string, name: string): void => {
      const trimmed = name.trim();
      if (!trimmed) return;
      commitSnapshot(
        (prev) => ({
          ...prev,
          folders: (prev.folders ?? []).map((f) =>
            f.id === id ? { ...f, name: trimmed } : f,
          ),
        }),
        `Renamed folder “${trimmed}”`,
      );
    },
    [commitSnapshot],
  );

  // Delete a folder: drop it from the registry and unset it on every note it
  // held, so the notes survive and reappear at the top level (undoable).
  const removeFolder = useCallback(
    (id: string): void => {
      const target = docRef.current.folders?.find((f) => f.id === id);
      const name = target ? target.name : "folder";
      const run = (): void =>
        commitSnapshot(
          (prev) => ({
            ...prev,
            folders: (prev.folders ?? []).filter((f) => f.id !== id),
            notes: prev.notes.map((n) =>
              n.folderId === id ? setNoteFolder(n, null) : n,
            ),
          }),
          `Deleted folder “${name}”`,
        );
      // Clearing the folder rewrites every note that was in it; load any
      // deferred ones first so the change reaches their `.enc` files.
      const affected = docRef.current.notes
        .filter((n) => n.folderId === id && n.body === undefined)
        .map((n) => n.id);
      if (affected.length === 0) run();
      else void Promise.all(affected.map(ensureBody)).then(run);
    },
    [commitSnapshot, ensureBody],
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

  // Folders in stable creation order. A note's `folderId` may point at a folder
  // the registry no longer carries (a stale link); the UI treats such a note as
  // ungrouped, so the list never has to defend against a dangling reference.
  const folders = useMemo(
    () => sortFoldersByCreated(sync.doc.folders ?? []),
    [sync.doc.folders],
  );

  return {
    notes: visible,
    allNotes: notes,
    archived: archivedList,
    folders,
    create,
    importFiles,
    update,
    attach,
    retitle,
    remove,
    archive,
    restore,
    moveNote,
    createFolder,
    renameFolder,
    removeFolder,
    ensureBody,
    undo,
    redo,
    canUndo,
    canRedo,
    sync,
  };
}
