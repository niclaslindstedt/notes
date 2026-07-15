// The notes store as a hook: projects the persistence engine
// (`use-notes-sync`) into the small mutation API the UI binds to. The sync
// engine owns the active `StorageAdapter` — localStorage, a local folder, or
// a cloud backend — and the debounced-save / conflict / offline machinery;
// this hook only translates "create / edit / delete a note" into a whole-
// document `Snapshot` swap, records each onto the undo timeline, and hands
// the sync state back up for the header indicator and the unlock / conflict
// surfaces.

import { useCallback, useMemo, useRef, useState } from "react";

import { unlock } from "../achievements/bus.ts";
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
import { sentenceBoundaryCount } from "../domain/sentence.ts";
import type { StorageAdapter } from "../storage/adapter.ts";
import { useNotesSync, type NotesSync } from "./use-notes-sync.ts";
import {
  DOC_SCOPE,
  mergeDocSnapshot,
  nextEditRun,
  useUndoRedo,
  type EditRun,
} from "./use-undo-redo.ts";

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
  /**
   * Delete a folder *and* every note filed in it, in one undoable step. Used
   * after the folder has been moved wholesale into another namespace, so the
   * source copy is cleared.
   */
  removeFolderWithNotes: (id: string) => void;
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
  /**
   * A counter bumped each time undo / redo restores a note's content, so the
   * open editor can scroll the reverted (or re-applied) part back into view. It
   * only ticks on a real content apply — a no-op at a timeline edge doesn't move
   * it — and the editor scrolls to wherever the body now differs from what's on
   * screen.
   */
  undoScrollSeq: number;
  // The persistence engine's live state — save status, conflict, offline —
  // for the header sync indicator and the conflict surface.
  sync: NotesSync;
};

export function useNotes(
  adapter: StorageAdapter,
  formatting?: SaveFormatting,
  activeNoteId: string | null = null,
  // Fired when the active backend surfaces `EncryptedRemoteError` on load —
  // encryption was turned on from another device. The caller adopts the
  // encrypted mode and shows the unlock gate.
  onEncryptedRemote?: () => void,
): NotesStore {
  // The undo timeline is built after the sync engine (it needs the engine's
  // `setDoc` / `scheduleSave` to apply a stepped-to snapshot), but the
  // engine's load / reload / conflict-adopt paths must reset that timeline.
  // Break the cycle with a ref the engine reads and the timeline fills once
  // it exists.
  const resetHistory = useRef<(seed: Snapshot) => void>(() => {});

  const sync = useNotesSync({
    active: adapter,
    resetHistory,
    formatting,
    onEncryptedRemote,
  });
  const notes = sync.doc.notes;

  // Latest document, read from the mutation callbacks so a rapid
  // create-then-type doesn't base its edit on a stale render's list.
  const docRef = useRef<Snapshot>(sync.doc);
  docRef.current = sync.doc;

  // Per-note edit-run state, so the body-edit merge key can break the undo
  // chain when typing reverses direction (type → erase → retype). Kept in a ref
  // (never rendered) and cleared whenever the document is reseeded from outside.
  const editRuns = useRef<Map<string, EditRun>>(new Map());

  // Bumped each time undo / redo applies a stepped-to entry, so the open editor
  // can scroll the reverted / re-applied part into view. Advances in lockstep
  // with the `setDoc` that swaps the body, so both land in the editor together.
  const [undoScrollSeq, setUndoScrollSeq] = useState(0);

  // The timeline undo / redo act on: the open note's own history, or the shared
  // structural timeline when no note is open (the list / archive views).
  const activeScope = activeNoteId ?? DOC_SCOPE;

  // Apply a snapshot stepped to off the undo / redo timeline: swap the visible
  // document and persist it so the reverted state survives a reload, exactly as
  // a normal edit would. A note scope splices just that note's content back into
  // the live document (leaving every other note as it stands now); `DOC_SCOPE`
  // restores the note set and structural fields while keeping surviving notes'
  // current bodies (see `mergeDocSnapshot`).
  const applyEntry = useCallback(
    (scope: string, entry: Snapshot) => {
      const cur = docRef.current;
      let next: Snapshot;
      if (scope === DOC_SCOPE) {
        next = mergeDocSnapshot(cur, entry);
      } else {
        const restored = entry.notes.find((n) => n.id === scope);
        if (!restored) return;
        const exists = cur.notes.some((n) => n.id === scope);
        next = {
          ...cur,
          notes: exists
            ? cur.notes.map((n) =>
                n.id === scope
                  ? {
                      ...n,
                      body: restored.body,
                      title: restored.title,
                      attachments: restored.attachments,
                      updatedAt: restored.updatedAt,
                    }
                  : n,
              )
            : [restored, ...cur.notes],
        };
      }
      docRef.current = next;
      sync.setDoc(next);
      sync.scheduleSave(next);
      // Signal the editor to reveal the changed region. Batched with `setDoc`,
      // so the new body and this tick reach the editor in the same commit.
      setUndoScrollSeq((s) => s + 1);
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
  } = useUndoRedo({ activeScope, apply: applyEntry });
  // Reseeding the document (load / reload / conflict-adopt) also clears the
  // edit-run bookkeeping so the next keystroke starts a fresh run.
  resetHistory.current = useCallback(() => {
    editRuns.current.clear();
    reset();
  }, [reset]);

  // Apply a producer over the latest snapshot, render it immediately, queue
  // the debounced save, and record the result on the given scope's undo
  // timeline. The single seam every mutation runs through. `scope` is the note
  // id for a note-scoped edit, or `DOC_SCOPE` for a structural change;
  // `mergeKey` coalesces a run of continuous edits (typing in one note) into a
  // single undo step.
  const commitSnapshot = useCallback(
    (
      producer: (prev: Snapshot) => Snapshot,
      label: string,
      scope: string,
      mergeKey: string | null = null,
    ): void => {
      const before = docRef.current;
      const next = producer(before);
      docRef.current = next;
      sync.setDoc(next);
      sync.scheduleSave(next);
      record({ scope, before, after: next, label, mergeKey });
    },
    [sync, record],
  );

  // The common case: a producer over just the notes list, preserving the
  // folder registry (and any other snapshot field) untouched.
  const commit = useCallback(
    (
      producer: (prev: Note[]) => Note[],
      label: string,
      scope: string,
      mergeKey: string | null = null,
    ): void => {
      commitSnapshot(
        (prev) => ({ ...prev, notes: producer(prev.notes) }),
        label,
        scope,
        mergeKey,
      );
    },
    [commitSnapshot],
  );

  // The merge key for a body edit of `id`: fold in the completed-sentence count
  // (so each finished sentence is its own checkpoint) and the edit-run counter
  // (so reversing typing direction — type, erase, retype — breaks the chain).
  const bodyEditKey = useCallback((id: string, body: string): string => {
    const run = nextEditRun(editRuns.current.get(id), body.length);
    editRuns.current.set(id, run);
    return `edit:${id}:${run.run}:${sentenceBoundaryCount(body)}`;
  }, []);

  // The current body-edit key for `id` without advancing its run — used by an
  // attachment paste so its record coalesces with the surrounding typing rather
  // than starting a fresh run.
  const currentBodyEditKey = useCallback((id: string, body: string): string => {
    const run = editRuns.current.get(id)?.run ?? 0;
    return `edit:${id}:${run}:${sentenceBoundaryCount(body)}`;
  }, []);

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
      commit((prev) => [note, ...prev], "New note", DOC_SCOPE);
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
      commit((prev) => [...fresh, ...prev], label, DOC_SCOPE);
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
      // Record onto the note's own timeline, keyed so keystrokes inside one
      // sentence coalesce, each finished sentence checkpoints, and reversing
      // direction (type → erase → retype) breaks into separate steps.
      commit(
        (prev) => prev.map((n) => (n.id === id ? editNote(n, body) : n)),
        `Edited note “${title}”`,
        id,
        bodyEditKey(id, body),
      );
    },
    [commit, bodyEditKey],
  );

  // Attach a pasted / dropped file to a note. The editor inserts the body
  // reference separately; this only adds the attachment record (its bytes),
  // which the storage layer externalises to a file on the file backends.
  // Coalesced with the body edit's undo step so one paste is one undo.
  const attach = useCallback(
    (id: string, attachment: Attachment): void => {
      // Share the key of the current sentence's edit step so the body
      // reference the editor inserts alongside this attachment coalesces with
      // it — one paste stays one undo.
      const current = docRef.current.notes.find((n) => n.id === id);
      const key = currentBodyEditKey(id, current?.body ?? "");
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
        id,
        key,
      );
    },
    [commit, currentBodyEditKey],
  );

  const retitle = useCallback(
    (id: string, title: string): void => {
      withBody(id, () =>
        commit(
          (prev) => prev.map((n) => (n.id === id ? retitleNote(n, title) : n)),
          `Renamed note “${title.trim() || "Untitled note"}”`,
          id,
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
        DOC_SCOPE,
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
          DOC_SCOPE,
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
          DOC_SCOPE,
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
          DOC_SCOPE,
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
        DOC_SCOPE,
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
        DOC_SCOPE,
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
          DOC_SCOPE,
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

  // Delete a folder along with every note filed in it (one undoable step). The
  // counterpart to `removeFolder`, which keeps the notes; this is the source-
  // side cleanup once the folder's contents have been written into another
  // namespace, so they don't linger in both places.
  const removeFolderWithNotes = useCallback(
    (id: string): void => {
      const target = docRef.current.folders?.find((f) => f.id === id);
      const name = target ? target.name : "folder";
      commitSnapshot(
        (prev) => ({
          ...prev,
          folders: (prev.folders ?? []).filter((f) => f.id !== id),
          notes: prev.notes.filter((n) => n.folderId !== id),
        }),
        `Moved folder “${name}” to another namespace`,
        DOC_SCOPE,
      );
    },
    [commitSnapshot],
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
    removeFolderWithNotes,
    ensureBody,
    undo,
    redo,
    canUndo,
    canRedo,
    undoScrollSeq,
    sync,
  };
}
