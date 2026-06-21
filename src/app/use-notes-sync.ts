// The notes persistence engine: the debounced-save plumbing, the
// save-status / dirty / conflict state machine, and the load / reload /
// save-now / resolve-conflict verbs that move bytes between the in-memory
// document and the active `StorageAdapter`. Ported from checklist's
// `use-checklist-sync`, adapted to the notes `Snapshot` (just a list of
// notes — no default-document seeding, since an empty notes list is a valid,
// rendered state).

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import { unlock } from "../achievements/index.ts";
import {
  DEFAULT_SAVE_FORMATTING,
  formatSnapshotForSave,
  type SaveFormatting,
  type Snapshot,
} from "../domain/note.ts";
import { createLogger } from "../dev/logger.ts";
import {
  AuthError,
  ConflictError,
  RateLimitError,
  type StorageAdapter,
  type StoredSnapshot,
} from "../storage/adapter.ts";
import { isOfflineError } from "../storage/cache/index.ts";
import {
  backoffDelayMs,
  isRetryableSaveError,
  MAX_TRANSIENT_SAVE_RETRIES,
} from "../storage/save-retry.ts";
import { parse, serialize } from "../storage/serialize.ts";

const log = createLogger("notes-sync");

// How often the live-pull loop polls a remote backend for someone else's
// edits, and — the same window — how long the note must sit quiet (no local
// keystroke) before a pull is allowed to replace what's on screen. This is the
// one knob behind "write on one device, watch it appear on another": shorten
// it for a snappier demo, lengthen it to poll less. Kept as a single named
// constant so it's trivial to change in one place.
export const LIVE_PULL_INTERVAL_MS = 10_000;

/**
 * Decide whether the live-pull loop may pull the remote right now. Pure so the
 * timing policy is unit-testable away from the interval. A pull is allowed only
 * on a remote backend, once the first load has settled, with nothing unsaved,
 * no open conflict, no save in flight, and only after the note has been quiet
 * for the full window — so a live pull can never clobber a keystroke mid-edit.
 */
export function shouldLivePull(opts: {
  backendId: StorageAdapter["id"];
  loaded: boolean;
  dirty: boolean;
  hasConflict: boolean;
  inFlight: boolean;
  msSinceLastEdit: number;
  intervalMs?: number;
}): boolean {
  const intervalMs = opts.intervalMs ?? LIVE_PULL_INTERVAL_MS;
  if (opts.backendId === "browser") return false;
  if (!opts.loaded || opts.dirty || opts.hasConflict || opts.inFlight) {
    return false;
  }
  return opts.msSinceLastEdit >= intervalMs;
}

/** A divergence between the on-screen document and the backend's. */
export type ConflictState = {
  /** The bytes currently on the backend (typically another device's edit). */
  remote: Snapshot;
  /** The remote revision to base a "keep mine" overwrite on. */
  remoteRevision?: string;
};

/**
 * Coarse state of the last save against the active backend, driving the
 * cloud-sync status glyph in the header.
 */
export type SaveStatus =
  | "idle"
  | "saving"
  | "saved"
  | "error"
  | "conflict"
  | "auth-error"
  | "throttled";

export interface NotesSync {
  /** The full in-memory document. */
  doc: Snapshot;
  /**
   * False until the active backend's first async load has resolved (and again
   * briefly across a backend swap).
   */
  loaded: boolean;
  /** Swap the visible document for an immediate re-render. */
  setDoc: (next: Snapshot) => void;
  /** Persist the edited document (debounced by the active backend). */
  scheduleSave: (next: Snapshot) => void;
  /**
   * Suspend writes to the backend while keeping edits in memory. Held while a
   * brand-new note is being titled so the file/cloud backends don't create its
   * file under the throwaway default-title filename (the filename is a slug of
   * the title) — the write is deferred until the title settles so the file is
   * born correctly named. A no-op safety net on the local browser backend,
   * which has no per-note filename to get wrong.
   */
  holdSaves: () => void;
  /** Lift a `holdSaves` hold and schedule a write for what accumulated. */
  releaseSaves: () => void;
  /** Set when a save collided with a newer remote revision; else null. */
  conflict: ConflictState | null;
  /** Coarse state of the last save, for the cloud-sync status glyph. */
  status: SaveStatus;
  /**
   * Human-readable reason the last save failed, captured from the thrown
   * error so the sync-details surface can show *what* went wrong. Only set
   * while `status === "error"`; null otherwise.
   */
  statusDetail: string | null;
  /** Whether there are local edits not yet persisted to the backend. */
  dirty: boolean;
  /**
   * True when the active backend is unreachable and the document on screen
   * came from (or is being held in) the on-device cache. Always false for the
   * local backends, which are never "offline".
   */
  offline: boolean;
  /** Re-read the document from the active backend, replacing what's on screen. */
  reload: () => Promise<void>;
  /**
   * Pull the latest from a remote backend (pull-to-refresh / foreground /
   * opening a note). Like `reload`, but a no-op on the local browser backend,
   * and it leaves the document and undo timeline untouched when nothing moved.
   */
  refresh: () => Promise<void>;
  /** Flush any debounced save immediately (the "save now" affordance). */
  saveNow: () => void;
  /** Resolve an open conflict by keeping this device's copy or the remote's. */
  resolveConflict: (keep: "local" | "remote") => void;
}

export function useNotesSync(deps: {
  active: StorageAdapter;
  // How to tidy each note's body before it's written to the backend
  // (format-on-save). Read through a ref at save time so a settings change
  // takes effect on the next save without re-arming the engine. Defaults to
  // the standard "trim + trailing newline" when the caller omits it.
  formatting?: SaveFormatting;
  // Called whenever the document is replaced wholesale from outside the edit
  // path (initial / swap load, reload, conflict-adopt) so the undo timeline
  // re-seeds against the new baseline instead of describing edits to a
  // document that's gone. The parent (`useNotes`) builds the timeline *after*
  // this engine — it needs the engine's `setDoc` / `scheduleSave` — so it
  // passes an empty ref here and fills it once the timeline exists.
  resetHistory?: MutableRefObject<(seed: Snapshot) => void>;
}): NotesSync {
  const { active, resetHistory } = deps;

  // Latest format-on-save settings, read from the save callbacks without
  // re-subscribing them to every render.
  const formattingRef = useRef<SaveFormatting>(
    deps.formatting ?? DEFAULT_SAVE_FORMATTING,
  );
  formattingRef.current = deps.formatting ?? DEFAULT_SAVE_FORMATTING;

  // Adapter and concurrency token survive re-renders.
  const adapterRef = useRef(active);
  const revisionRef = useRef<string | undefined>(undefined);
  // The last snapshot we loaded or saved, handed back to `load` as the
  // `previous` hint so a live pull lists cheaply and re-downloads only the
  // files whose revision actually moved (the file-per-note backends' read half
  // of incremental sync) — "pull the metadata, download only what changed".
  const lastStoredRef = useRef<StoredSnapshot | undefined>(undefined);
  // Wall-clock time of the last local edit (any `scheduleSave`). The live-pull
  // loop reads it to honour the quiet window — a pull only lands once the note
  // has sat untouched for the full interval. 0 ⇒ "never edited", so a device
  // that's only viewing still receives pulls.
  const lastEditRef = useRef(0);

  // Seed from the adapter's synchronous fast path so the first paint shows
  // stored data instead of a flash of empty list.
  const [doc, setDocState] = useState<Snapshot>(() =>
    parse(active.loadSync?.()?.text),
  );
  // Latest doc, readable from async callbacks (debounced save, conflict
  // resolution) without re-subscribing them to every render.
  const docRef = useRef(doc);
  const setDoc = useCallback((next: Snapshot) => {
    docRef.current = next;
    setDocState(next);
  }, []);

  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [offline, setOffline] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Debounced-save plumbing. `pendingDoc` holds the latest unsaved document;
  // the timer coalesces a burst of edits into one write per `saveDebounceMs`
  // window (0 ⇒ save immediately, right for localStorage).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDoc = useRef<Snapshot | null>(null);
  // While true, `scheduleSave` accumulates edits into `pendingDoc` without
  // arming a write and `flushSave` refuses to fire. Held while a brand-new note
  // is being titled so its file isn't written under the default-title filename
  // before the real title lands; lifted (and drained) by `releaseSaves` when
  // the title settles.
  const saveHeld = useRef(false);
  // At most one write is in flight at a time. A second save started before the
  // first resolves would base on a revision the in-flight write is about to
  // bump, so the backend rejects the loser as a ConflictError — the device
  // colliding with *itself* on a slow link. Instead we queue: edits pile up in
  // `pendingDoc` (each a complete snapshot, so the newest covers every one
  // before it) and drain in a single follow-up save once the in-flight write
  // returns with a fresh revision.
  const inFlight = useRef(false);
  // Bumped whenever the on-screen document is replaced wholesale (backend
  // swap, reload, conflict-adopt). An in-flight save captures the value at
  // launch; if it no longer matches when the save resolves, the result
  // describes a baseline that's gone — its revision and any queued follow-up
  // are stale, so the completion handler bails instead of writing back.
  const saveGeneration = useRef(0);
  // Forward handle to `flushSave` (defined below): `performSave` calls it to
  // drain a queued edit on completion, but `flushSave` is built on top of
  // `performSave`, so the cycle is broken through a ref.
  const flushSaveRef = useRef<() => void>(() => {});
  // A scheduled re-save during a cooldown: either a rate-limit throttle (HTTP
  // 429) waiting out the backend's `Retry-After`, or a transient backend
  // hiccup backing off before another attempt. Non-null means a cooldown is in
  // progress — `flushSave` refuses to start a fresh write while it's armed so
  // edits coalesce into the one resume.
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Count of back-to-back rate limits (HTTP 429) with no successful save in
  // between. Drives the backoff floor on the throttle path. Reset to 0 the
  // moment a save lands.
  const consecutiveThrottles = useRef(0);
  // Count of consecutive transient (non-typed) save failures. Bounds the
  // automatic retry curve. Reset to 0 on success.
  const transientRetries = useRef(0);

  // Schedule a resume `waitMs` from now after a save backed off. Re-queues the
  // failed snapshot — unless a newer edit already superseded it — then arms
  // the cooldown timer, which bails if the document was swapped wholesale
  // before it fired.
  const armResave = useCallback((failedDoc: Snapshot, waitMs: number) => {
    if (pendingDoc.current === null) pendingDoc.current = failedDoc;
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    const generation = saveGeneration.current;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      if (saveGeneration.current !== generation) return;
      flushSaveRef.current();
    }, waitMs);
  }, []);

  const performSave = useCallback(
    (next: Snapshot, baseRevision?: string) => {
      const generation = saveGeneration.current;
      inFlight.current = true;
      setStatus("saving");
      // Tidy the body of each note in the bytes we persist (format-on-save).
      // Only the stored snapshot is normalised; `next` (and so the on-screen
      // document and undo timeline) stays exactly as typed.
      const bytes = serialize(
        formatSnapshotForSave(next, formattingRef.current),
      );
      void adapterRef.current
        .save(bytes, baseRevision)
        .then((stored) => {
          inFlight.current = false;
          if (saveGeneration.current !== generation) return;
          consecutiveThrottles.current = 0;
          transientRetries.current = 0;
          setOffline(false);
          revisionRef.current = stored.revision;
          lastStoredRef.current = stored;
          if (pendingDoc.current !== null) {
            flushSaveRef.current();
          } else {
            setDirty(false);
            setStatus("saved");
            setStatusDetail(null);
          }
        })
        .catch((err: unknown) => {
          inFlight.current = false;
          if (saveGeneration.current !== generation) return;
          if (isOfflineError(err)) setOffline(true);
          if (err instanceof ConflictError) {
            log.warn("save: remote moved — surfacing conflict");
            setStatus("conflict");
            setStatusDetail(null);
            setConflict({
              remote: parse(err.remote.text),
              remoteRevision: err.remote.revision,
            });
          } else if (err instanceof AuthError) {
            log.error("save: auth error", err);
            setStatus("auth-error");
            setStatusDetail(null);
          } else if (err instanceof RateLimitError) {
            const floorMs = backoffDelayMs(consecutiveThrottles.current);
            consecutiveThrottles.current += 1;
            const waitMs = Math.max(err.retryAfterMs, floorMs);
            log.warn(`save throttled — resume in ${waitMs}ms`);
            setStatus("throttled");
            setStatusDetail(null);
            armResave(next, waitMs);
          } else if (
            isRetryableSaveError(err) &&
            transientRetries.current < MAX_TRANSIENT_SAVE_RETRIES
          ) {
            const waitMs = backoffDelayMs(transientRetries.current);
            transientRetries.current += 1;
            log.warn(
              `save failed — retrying in ${waitMs}ms (attempt ${transientRetries.current}/${MAX_TRANSIENT_SAVE_RETRIES})`,
              err,
            );
            armResave(next, waitMs);
          } else {
            log.error("save failed", err);
            transientRetries.current = 0;
            if (pendingDoc.current === null) pendingDoc.current = next;
            setStatus("error");
            setStatusDetail(err instanceof Error ? err.message : String(err));
          }
        });
    },
    [armResave],
  );

  const flushSave = useCallback(() => {
    if (saveHeld.current) return;
    if (saveTimer.current !== null) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (inFlight.current) return;
    if (retryTimer.current !== null) return;
    const next = pendingDoc.current;
    if (next === null) return;
    pendingDoc.current = null;
    performSave(next, revisionRef.current);
  }, [performSave]);

  useEffect(() => {
    flushSaveRef.current = flushSave;
  }, [flushSave]);

  const scheduleSave = useCallback(
    (next: Snapshot) => {
      // Stamp the edit so the live-pull loop holds off until the note has been
      // quiet for the full window — this is the keystroke that resets it.
      lastEditRef.current = Date.now();
      pendingDoc.current = next;
      setDirty(true);
      if (saveHeld.current) return;
      const ms = adapterRef.current.saveDebounceMs ?? 0;
      if (ms <= 0) {
        flushSave();
        return;
      }
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flushSave, ms);
    },
    [flushSave],
  );

  // Hold/release the debounced-save loop while a brand-new note is being
  // titled. Holding also cancels any armed timer so a save scheduled just
  // before can't slip through the window; releasing schedules a fresh
  // debounced write for whatever piled up, now that the title — and so the
  // filename — has settled.
  const holdSaves = useCallback(() => {
    saveHeld.current = true;
    if (saveTimer.current !== null) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);
  const releaseSaves = useCallback(() => {
    if (!saveHeld.current) return;
    saveHeld.current = false;
    if (pendingDoc.current !== null) scheduleSave(pendingDoc.current);
  }, [scheduleSave]);

  // Reload whenever the active adapter instance changes. On first mount this
  // re-confirms the loadSync seed (same bytes, no flicker); on a mid-session
  // swap (namespace switch, backend change, encryption unlock) it reseeds the
  // on-screen document from the new adapter's synchronous cached index right
  // away, then loads the live copy and reconciles. Reseeding synchronously is
  // what stops a swap from showing the *previous* namespace's notes (or a blank
  // list) for the seconds the async load can take. Any pending save against the
  // old backend is flushed first so an in-flight edit isn't dropped, and the
  // concurrency token resets so the first save against the new backend isn't
  // rejected.
  useEffect(() => {
    if (retryTimer.current !== null) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    consecutiveThrottles.current = 0;
    transientRetries.current = 0;
    flushSave();
    saveGeneration.current += 1;
    inFlight.current = false;
    pendingDoc.current = null;
    adapterRef.current = active;
    revisionRef.current = undefined;
    // A new backend's files are unrelated to the old one's, so drop the
    // incremental-load hint rather than letting it mislead the reuse check.
    lastStoredRef.current = undefined;
    setConflict(null);
    setStatus("idle");
    setStatusDetail(null);
    setDirty(false);
    setLoaded(false);
    // Paint the new adapter's last-known document synchronously, so a namespace
    // switch (or backend swap) shows the *target's* content on the first frame
    // instead of leaving the previous namespace's notes — or a blank list — on
    // screen for the seconds the async `load()` can take. `loadSync` is the
    // adapter's cached index: the stored document for the browser backend, the
    // offline mirror for the cloud backends. Absent (a never-visited namespace,
    // or a still-sealed encrypted mirror) it parses to a blank document — showing
    // nothing beats showing the wrong namespace's notes. The async `load()` below
    // still runs and reconciles with the live copy.
    const seeded = parse(active.loadSync?.()?.text);
    setDoc(seeded);
    resetHistory?.current(seeded);
    let cancelled = false;
    void active
      .load()
      .then((stored) => {
        if (cancelled) return;
        revisionRef.current = stored?.revision;
        lastStoredRef.current = stored ?? undefined;
        setOffline(stored?.offline ?? false);
        const loadedDoc = parse(stored?.text);
        setDoc(loadedDoc);
        resetHistory?.current(loadedDoc);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        log.warn("initial load failed", err);
        if (isOfflineError(err)) setOffline(true);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [active, flushSave, setDoc, resetHistory]);

  // Flush any pending save on unmount so a debounced edit isn't lost, and
  // cancel any armed cooldown so the resume timer can't fire after teardown.
  useEffect(() => {
    return () => {
      if (retryTimer.current !== null) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
      flushSave();
    };
  }, [flushSave]);

  const reload = useCallback(async () => {
    if (retryTimer.current !== null) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    consecutiveThrottles.current = 0;
    transientRetries.current = 0;
    flushSave();
    saveGeneration.current += 1;
    inFlight.current = false;
    pendingDoc.current = null;
    const prevRevision = revisionRef.current;
    let stored;
    try {
      // Hand the last-known snapshot in so a file-per-note backend lists
      // cheaply and only re-downloads the notes whose revision moved.
      stored = await adapterRef.current.load(lastStoredRef.current);
    } catch (err) {
      log.warn("reload failed", err);
      if (isOfflineError(err)) setOffline(true);
      return;
    }
    revisionRef.current = stored?.revision;
    lastStoredRef.current = stored ?? undefined;
    setOffline(stored?.offline ?? false);
    setConflict(null);
    setStatus("idle");
    setStatusDetail(null);
    // A refresh that finds the remote unchanged must not replace the document
    // or reset the undo timeline — that would wipe the user's place every time
    // a poll, foreground, or note-open turned up nothing new.
    if (stored?.revision !== undefined && stored.revision === prevRevision) {
      return;
    }
    setDirty(false);
    const reloaded = parse(stored?.text);
    setDoc(reloaded);
    resetHistory?.current(reloaded);
  }, [flushSave, setDoc, resetHistory]);

  // The pull-to-refresh / foreground / open-note gesture: re-read the backend,
  // but only for backends that actually have a remote to diverge from — the
  // local browser store has no other writer, so refreshing it would just churn
  // the undo timeline for nothing.
  const refresh = useCallback(async () => {
    if (adapterRef.current.id === "browser") return;
    await reload();
  }, [reload]);

  // When connectivity returns, flush whatever edit piled up offline so it
  // syncs to the backend without the user lifting a finger.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOnline = () => {
      log.info("connectivity restored — flushing queued save");
      flushSaveRef.current();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  // Coming back to the app (a tab refocus, returning from the home screen on
  // mobile) pulls the latest from the backend — the "exit and open again"
  // refresh, without a manual gesture. `refresh` is a no-op on the local
  // backend and cheap (incremental) on the cloud ones.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      log.info("app foregrounded — refreshing from backend");
      void refreshRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Live pull: poll a remote backend on a fixed cadence so an edit made on
  // another device appears here on its own — the trick behind "write on one
  // device, watch it show up on the other", even with the note open in the
  // editor. `shouldLivePull` gates each tick on the quiet window and the
  // save/conflict state so a pull never lands mid-keystroke; `refresh` itself
  // no-ops on the local backend and leaves the document (and undo timeline)
  // untouched when the remote hasn't moved. State is read through refs so the
  // interval is armed once, not re-created on every render.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const conflictRef = useRef(conflict);
  conflictRef.current = conflict;
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = setInterval(() => {
      if (
        !shouldLivePull({
          backendId: adapterRef.current.id,
          loaded: loadedRef.current,
          dirty: dirtyRef.current,
          hasConflict: conflictRef.current !== null,
          inFlight: inFlight.current,
          msSinceLastEdit: Date.now() - lastEditRef.current,
        })
      ) {
        return;
      }
      const before = revisionRef.current;
      void refreshRef.current().then(() => {
        // A pull that actually moved the document is another device's edit
        // arriving live, all on its own — the "live sync" trophy.
        if (before !== undefined && revisionRef.current !== before) {
          unlock("liveSync");
        }
      });
    }, LIVE_PULL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const saveNow = useCallback(() => {
    flushSave();
  }, [flushSave]);

  const resolveConflict = useCallback(
    (keep: "local" | "remote") => {
      setConflict((current) => {
        if (!current) return null;
        // Settling a real divergence either way is the "Peacemaker" trophy.
        unlock("peacemaker");
        if (keep === "local") {
          // Overwrite the remote: re-save this device's bytes basing the
          // write on the remote revision so the backend accepts it.
          revisionRef.current = current.remoteRevision;
          performSave(docRef.current, current.remoteRevision);
        } else {
          // Adopt the remote bytes as the new in-memory state and stamp its
          // revision so the next edit bases on it — no immediate write-back,
          // so we don't bounce the conflict.
          saveGeneration.current += 1;
          inFlight.current = false;
          pendingDoc.current = null;
          revisionRef.current = current.remoteRevision;
          setDoc(current.remote);
          resetHistory?.current(current.remote);
          setDirty(false);
          setStatus("saved");
          setStatusDetail(null);
        }
        return null;
      });
    },
    [performSave, setDoc, resetHistory],
  );

  return {
    doc,
    setDoc,
    scheduleSave,
    holdSaves,
    releaseSaves,
    conflict,
    status,
    statusDetail,
    dirty,
    offline,
    loaded,
    reload,
    refresh,
    saveNow,
    resolveConflict,
  };
}
