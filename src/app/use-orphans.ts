// The orphan-files prompt's state and verbs.
//
// A file/cloud backend stores each note as a real file in a folder the user can
// also open, edit, and drop things into — so a load can turn up files that
// aren't notes: a markdown file hand-authored in Dropbox (no frontmatter, so
// nothing ties it to a note), or a file whose extension the app doesn't own at
// all. The directory adapter reports them (`getOrphans`) and, crucially,
// refuses to delete them; this hook is what turns that report into a decision
// the user makes.
//
// It runs after each settled load: the adapter's orphan set is a property of the
// last listing, so it is read once the load resolves rather than subscribed to.
// Ignored paths are filtered out here rather than in the adapter, because
// "don't ask me again" is a device preference (see `storage/orphan-ignore.ts`)
// and the adapter's job is only to report what it found.

import { useCallback, useEffect, useMemo, useState } from "react";

import { unlock } from "../achievements/bus.ts";
import { createLogger } from "../dev/logger.ts";
import type { OrphanFile, StorageAdapter } from "../storage/adapter.ts";
import {
  forgetOrphanPath,
  ignoreOrphanPath,
  readIgnoredOrphans,
} from "../storage/orphan-ignore.ts";

const log = createLogger("sync");

export interface OrphansStore {
  /** Unmatched files awaiting a decision, ignored ones already filtered out. */
  files: OrphanFile[];
  /** Whether the prompt should be showing. */
  open: boolean;
  /** Read one orphan's text for the preview. Null when it's gone. */
  preview: (path: string) => Promise<string | null>;
  /**
   * Adopt the file as a note: its contents become the body and its filename the
   * title. The original file is then deleted — the adopted note is written at
   * the app's own canonical path on the next save, so leaving it would just
   * duplicate the content and re-flag on the next load.
   */
  adopt: (path: string) => Promise<void>;
  /** Delete the file from the backend. The only path that ever removes one. */
  discard: (path: string) => Promise<void>;
  /** Never flag this path again on this device. */
  ignore: (path: string) => void;
  /** Close the prompt, leaving every remaining file untouched (asks again). */
  dismiss: () => void;
}

export function useOrphans(deps: {
  adapter: StorageAdapter;
  backendId: string;
  namespace: string;
  /** False until the active adapter's load has settled. */
  loaded: boolean;
  /** Adopt files into the document — `NotesStore.importFiles`. */
  importFiles: (files: readonly { name: string; text: string }[]) => number;
}): OrphansStore {
  const { adapter, backendId, namespace, loaded, importFiles } = deps;

  const [found, setFound] = useState<OrphanFile[]>([]);
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() =>
    readIgnoredOrphans(backendId, namespace),
  );
  // Paths the user has waved away for this session. Tracked as a set rather
  // than one boolean so that dismissing the prompt silences *those* files only
  // — a file that turns up on a later load still reopens it.
  const [dismissedPaths, setDismissedPaths] = useState<ReadonlySet<string>>(
    new Set(),
  );

  // Re-read the ignore list whenever the folder being looked at changes, so
  // switching namespace or backend doesn't carry the previous one's silences.
  useEffect(() => {
    setIgnored(readIgnoredOrphans(backendId, namespace));
    setDismissedPaths(new Set());
    setFound([]);
  }, [backendId, namespace]);

  // Collect what the last load found. `loaded` gates this so we read the
  // adapter's set only once its listing is real — before that it's either empty
  // (a fresh adapter) or the previous namespace's, and flashing a prompt for
  // files the user isn't looking at would be worse than showing it a beat late.
  useEffect(() => {
    if (!loaded || !adapter.capabilities.has("orphans")) {
      setFound([]);
      return;
    }
    const next = adapter.getOrphans?.() ?? [];
    setFound(next);
    if (next.length > 0) {
      log.info(`orphans: ${next.length} unmatched file(s) awaiting a decision`);
    }
  }, [adapter, loaded]);

  const files = useMemo(
    () => found.filter((o) => !ignored.has(o.path)),
    [found, ignored],
  );

  // Drop one path from the pending set once it has been dealt with, so the row
  // disappears without waiting for the next load to re-list the folder.
  const settle = useCallback((path: string) => {
    setFound((prev) => prev.filter((o) => o.path !== path));
  }, []);

  const preview = useCallback(
    async (path: string) => {
      try {
        return (await adapter.readOrphan?.(path)) ?? null;
      } catch (err) {
        log.warn(`orphans: preview failed for ${path}`, err);
        return null;
      }
    },
    [adapter],
  );

  const adopt = useCallback(
    async (path: string) => {
      const text = await adapter.readOrphan?.(path);
      if (text === null || text === undefined) {
        // Gone from under us (another device tidied it) — nothing to adopt, and
        // nothing to delete either.
        settle(path);
        return;
      }
      importFiles([{ name: path, text }]);
      // Remove the original only after the note is in the document, so an error
      // here leaves a duplicate rather than losing the content.
      try {
        await adapter.removeOrphan?.(path);
      } catch (err) {
        log.warn(`orphans: adopted ${path} but couldn't remove the file`, err);
      }
      // A file may later reappear at this path; a stale silence would hide it.
      setIgnored(forgetOrphanPath(backendId, namespace, path));
      settle(path);
      unlock("straggler");
    },
    [adapter, backendId, namespace, importFiles, settle],
  );

  const discard = useCallback(
    async (path: string) => {
      try {
        await adapter.removeOrphan?.(path);
      } catch (err) {
        log.warn(`orphans: removing ${path} failed`, err);
        return;
      }
      setIgnored(forgetOrphanPath(backendId, namespace, path));
      settle(path);
      unlock("straggler");
    },
    [adapter, backendId, namespace, settle],
  );

  const ignore = useCallback(
    (path: string) => {
      setIgnored(ignoreOrphanPath(backendId, namespace, path));
      unlock("straggler");
    },
    [backendId, namespace],
  );

  const dismiss = useCallback(
    () => setDismissedPaths(new Set(found.map((o) => o.path))),
    [found],
  );

  return {
    files,
    open: files.some((o) => !dismissedPaths.has(o.path)),
    preview,
    adopt,
    discard,
    ignore,
    dismiss,
  };
}
