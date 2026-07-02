// The cross-namespace move concern of the storage backend, lifted out of
// `useStorageBackend` into a self-contained hook: the two verbs that copy a
// note — or a whole folder and every note filed in it — into another
// namespace's document on the same backend.
//
// Unlike the encryption / folder / cloud seams there is no render-order cycle
// here: the verbs are leaf consumers of the resolved selection. They read the
// active document adapter (`inner`), the ability to build an adapter for *any*
// namespace on the current selection (`makeInner`), and the browser-only
// whole-document encryption wrapper (`wrapBrowserForActive`) — all built by the
// orchestrator before this hook runs. So the deps come in as plain arguments
// and the verbs are directly unit-testable against in-memory adapters.

import { useCallback } from "react";

import { createLogger } from "../dev/logger.ts";
import type { Folder, Note } from "../domain/note.ts";
import type { StorageAdapter } from "./adapter.ts";
import { bytesToDataUrl } from "./attachment-store.ts";
import type { Namespace } from "./namespaces.ts";
import { parse, serialize } from "./serialize.ts";

const log = createLogger("storage");

export interface NamespaceMigrationDeps {
  /** True while the store is locked (encryption on, no passphrase held). */
  locked: boolean;
  /** The active namespace's slug — moves into it are a no-op. */
  activeNamespace: string;
  /** Namespaces known on this device — an unknown target is a no-op. */
  namespaces: Namespace[];
  /** The active namespace's adapter, used to hydrate note bodies/attachments. */
  inner: StorageAdapter;
  /**
   * Whether the active selection is the single-document browser backend, which
   * needs the whole-document encryption wrapper around the target adapter (the
   * file/cloud adapters encrypt per-file internally).
   */
  isBrowserBackend: boolean;
  /** Wrap a browser adapter in the whole-document at-rest encryption layer. */
  wrapBrowserForActive: (raw: StorageAdapter) => StorageAdapter;
  /** Build the unwrapped adapter for any namespace on the current selection. */
  makeInner: (namespace: string) => StorageAdapter;
}

export interface NamespaceMigration {
  /**
   * Move a note (with its attachment bytes) into another namespace on the same
   * backend: write it into the target namespace's document, returning true on
   * success. The caller removes it from the source namespace. A no-op (false)
   * for the active namespace, an unknown target, or while locked.
   */
  moveNoteToNamespace: (note: Note, targetSlug: string) => Promise<boolean>;
  /**
   * Move a whole folder — its record and every note filed in it (with their
   * bodies and attachment bytes) — into another namespace on the same backend.
   * Writes them into the target namespace's document, keeping each note filed
   * under the folder, and returns true on success. The caller removes the
   * folder and its notes from the source namespace. A no-op (false) for the
   * active namespace, an unknown target, or while locked.
   */
  moveFolderToNamespace: (
    folder: Folder,
    notes: Note[],
    targetSlug: string,
  ) => Promise<boolean>;
}

export function useNamespaceMigration(
  deps: NamespaceMigrationDeps,
): NamespaceMigration {
  const {
    locked,
    activeNamespace,
    namespaces,
    inner,
    isBrowserBackend,
    wrapBrowserForActive,
    makeInner,
  } = deps;

  const moveNoteToNamespace = useCallback(
    async (note: Note, targetSlug: string): Promise<boolean> => {
      if (locked) return false;
      if (targetSlug === activeNamespace) return false;
      if (!namespaces.some((n) => n.slug === targetSlug)) return false;

      // Bring the note's attachment bytes in hand (the list loads metadata
      // only) so they travel into the target namespace's store, where the
      // directory adapter externalises them on save.
      let moved: Note = note;
      if (note.attachments?.length) {
        const copy: Note = {
          ...note,
          attachments: note.attachments.map((a) => ({ ...a })),
        };
        for (const a of copy.attachments!) {
          if (a.data) continue;
          const got = await inner.fetchAttachment?.(note, a.filename);
          if (got) a.data = bytesToDataUrl(got.mime, got.bytes);
        }
        moved = copy;
      }
      // The target namespace has its own folders, so the source folder link is
      // meaningless there — drop it.
      if (moved.folderId) {
        moved = { ...moved };
        delete moved.folderId;
      }

      // The browser store needs the whole-document encryption wrapper; the
      // file/cloud adapters encrypt per-file internally via `directoryCrypto`.
      const target = isBrowserBackend
        ? wrapBrowserForActive(makeInner(targetSlug))
        : makeInner(targetSlug);
      const prev = await target.load().catch(() => null);
      const doc = prev ? parse(prev.text) : parse(null);
      doc.notes = [moved, ...doc.notes.filter((n) => n.id !== moved.id)];
      try {
        await target.save(serialize(doc), prev?.revision);
      } catch (err) {
        log.warn(
          `moveNoteToNamespace: target save failed (${targetSlug})`,
          err,
        );
        return false;
      }
      log.info(`moveNoteToNamespace: ${note.id} → ${targetSlug}`);
      return true;
    },
    [
      locked,
      activeNamespace,
      namespaces,
      inner,
      isBrowserBackend,
      wrapBrowserForActive,
      makeInner,
    ],
  );

  const moveFolderToNamespace = useCallback(
    async (
      folder: Folder,
      folderNotes: Note[],
      targetSlug: string,
    ): Promise<boolean> => {
      if (locked) return false;
      if (targetSlug === activeNamespace) return false;
      if (!namespaces.some((n) => n.slug === targetSlug)) return false;

      // Hydrate each note so the whole folder travels intact: the encrypted
      // file/cloud backends render the list from an index with bodies (and
      // attachment bytes) left unloaded, but the target store needs the full
      // note to seal it. Each note keeps its `folderId` — the folder record
      // travels alongside, so the notes stay filed under it in the target.
      const moved: Note[] = [];
      for (const note of folderNotes) {
        let m: Note = note;
        if (m.body === undefined && inner.fetchNoteBody) {
          const body = await inner.fetchNoteBody(note);
          if (body !== null) m = { ...m, body, preview: undefined };
        }
        if (m.attachments?.length) {
          const copy: Note = {
            ...m,
            attachments: m.attachments.map((a) => ({ ...a })),
          };
          for (const a of copy.attachments!) {
            if (a.data) continue;
            const got = await inner.fetchAttachment?.(note, a.filename);
            if (got) a.data = bytesToDataUrl(got.mime, got.bytes);
          }
          m = copy;
        }
        moved.push(m);
      }

      const target = isBrowserBackend
        ? wrapBrowserForActive(makeInner(targetSlug))
        : makeInner(targetSlug);
      const prev = await target.load().catch(() => null);
      const doc = prev ? parse(prev.text) : parse(null);
      const movedIds = new Set(moved.map((n) => n.id));
      doc.notes = [...moved, ...doc.notes.filter((n) => !movedIds.has(n.id))];
      // Carry the folder record across (replacing any same-id remnant), so the
      // moved notes resolve to a real folder in the target.
      doc.folders = [
        folder,
        ...(doc.folders ?? []).filter((f) => f.id !== folder.id),
      ];
      try {
        await target.save(serialize(doc), prev?.revision);
      } catch (err) {
        log.warn(
          `moveFolderToNamespace: target save failed (${targetSlug})`,
          err,
        );
        return false;
      }
      log.info(
        `moveFolderToNamespace: ${folder.id} (${moved.length} notes) → ${targetSlug}`,
      );
      return true;
    },
    [
      locked,
      activeNamespace,
      namespaces,
      inner,
      isBrowserBackend,
      wrapBrowserForActive,
      makeInner,
    ],
  );

  return { moveNoteToNamespace, moveFolderToNamespace };
}
