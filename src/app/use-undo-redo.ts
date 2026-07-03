// In-memory undo / redo over whole-document snapshots, ported from
// checklist's `use-undo-redo` and then **scoped per note**. Each user edit
// records the resulting `Snapshot` together with a short human label and an
// optional merge key, filed under a *scope* — the id of the note being edited,
// or the shared `DOC_SCOPE` for structural changes that aren't about one note
// (create / delete / archive / move / folder ops / import).
//
// The scope is what makes undo feel per-note: switching notes switches which
// timeline ⌘/Ctrl+Z walks, so a burst of edits in one note never gets reverted
// while you're looking at another, and each note keeps its own place in its own
// history for the whole session. `undo` / `redo` always act on the *active*
// scope (`activeScope`), and `canUndo` / `canRedo` report that scope too so the
// buttons dim against the right timeline.
//
// Because a snapshot is the *entire* document, a deleted note still lives in the
// prior entry — that's what lets "undo" bring it back. But whole-snapshot
// replacement would clobber edits made in *other* scopes since, so the caller
// (`useNotes`) applies a stepped-to entry surgically: a note scope splices just
// that note's content back into the live document, and `DOC_SCOPE` restores the
// note *set* and structural fields while keeping each surviving note's current
// body (see `mergeDocSnapshot`).
//
// One adaptation for the notes domain: a note's body is edited continuously,
// one keystroke at a time, so recording every `update` verbatim would flood the
// timeline with a separate entry per character. Edits carry an optional
// `mergeKey`; when the newest entry in the scope shares the same key, a fresh
// record *replaces* it in place rather than appending. The body edit key folds
// in the completed-sentence count (see `domain/sentence.ts`) and the edit-run
// counter (see `nextEditRun`), so keystrokes within one sentence coalesce, each
// finished sentence locks in as its own checkpoint, and reversing direction
// (type, erase, retype) breaks the chain instead of swallowing the erase. A
// `create` / `remove` (no key) always lands as its own step. The textarea's
// native undo still handles character-level reverts *within* a sentence.

import { useCallback, useReducer, useRef } from "react";

import type { Snapshot } from "../domain/note.ts";

// The shared timeline for structural edits that aren't scoped to a single note
// (create / delete / archive / restore / move / folder ops / import). Underscores
// so it can never collide with a real note id (a UUID is hex and hyphens).
export const DOC_SCOPE = "__doc__";

// Maximum number of past states retained *per scope*. Snapshots share structure
// with their neighbours (a mutation rebuilds only the touched note), so
// unchanged notes are not duplicated across entries.
const UNDO_HISTORY_LIMIT = 50;

// One step on a scope's timeline: the document as it stood after an action,
// paired with the label of the action that produced it and an optional merge
// key (set for coalescable continuous edits). A scope's seed entry (the
// document as it stood *before* the scope's first recorded edit) has no
// originating action, so its label is null and undo never announces it.
type HistoryEntry = {
  snapshot: Snapshot;
  label: string | null;
  mergeKey: string | null;
};

// One note's (or the document's) timeline: the recorded entries and the cursor
// into them.
type Timeline = {
  entries: HistoryEntry[];
  cursor: number;
};

// Every scope's timeline, keyed by scope id. A scope is created lazily the
// first time something is recorded against it, seeded with the pre-edit
// document so undo can walk back to where the scope started.
type HistoryState = {
  scopes: Record<string, Timeline>;
};

type HistoryAction =
  | { kind: "reset" }
  | {
      kind: "record";
      scope: string;
      // The document *before* this edit — used to seed the scope's timeline the
      // first time it's touched, so undo can return to the pre-edit state.
      before: Snapshot;
      snapshot: Snapshot;
      label: string;
      mergeKey: string | null;
    }
  // Move a scope's cursor by ±1, clamped at the timeline edges — the bounds
  // check is what makes undo / redo no-ops at the ends.
  | { kind: "step"; scope: string; delta: -1 | 1 };

function historyReducer(
  state: HistoryState,
  action: HistoryAction,
): HistoryState {
  switch (action.kind) {
    case "reset":
      return { scopes: {} };
    case "record": {
      // Seed the scope lazily with the pre-edit document so its first undo has
      // somewhere to land.
      const timeline: Timeline = state.scopes[action.scope] ?? {
        entries: [{ snapshot: action.before, label: null, mergeKey: null }],
        cursor: 0,
      };
      const next = recordInto(timeline, action);
      return { scopes: { ...state.scopes, [action.scope]: next } };
    }
    case "step": {
      const timeline = state.scopes[action.scope];
      if (!timeline) return state;
      const next = timeline.cursor + action.delta;
      if (next < 0 || next >= timeline.entries.length) return state;
      return {
        scopes: {
          ...state.scopes,
          [action.scope]: { entries: timeline.entries, cursor: next },
        },
      };
    }
  }
}

// Append (or coalesce) one recorded edit onto a single scope's timeline.
function recordInto(
  timeline: Timeline,
  action: Extract<HistoryAction, { kind: "record" }>,
): Timeline {
  // Coalesce a continuous edit into the newest entry when the cursor sits at
  // the head and that entry shares the merge key — successive keystrokes in one
  // note collapse to a single undo step.
  const atHead = timeline.cursor === timeline.entries.length - 1;
  const head = timeline.entries[timeline.cursor];
  if (
    atHead &&
    action.mergeKey !== null &&
    head &&
    head.mergeKey === action.mergeKey
  ) {
    const merged = timeline.entries.slice();
    merged[timeline.cursor] = {
      snapshot: action.snapshot,
      label: action.label,
      mergeKey: action.mergeKey,
    };
    return { entries: merged, cursor: timeline.cursor };
  }
  // Drop any "future" entries beyond the cursor — a fresh edit overwrites the
  // redo timeline. Append, then trim from the front if the past portion would
  // exceed the retention limit.
  const truncated = timeline.entries.slice(0, timeline.cursor + 1);
  const appended = [
    ...truncated,
    {
      snapshot: action.snapshot,
      label: action.label,
      mergeKey: action.mergeKey,
    },
  ];
  const cap = UNDO_HISTORY_LIMIT + 1;
  const dropped = Math.max(0, appended.length - cap);
  return {
    entries: dropped > 0 ? appended.slice(dropped) : appended,
    cursor: appended.length - 1 - dropped,
  };
}

// The direction/run bookkeeping the body-edit merge key folds in so a reversal
// of typing direction breaks the undo chain. `dir` is the sign of the last
// length change (`0` before the first change is known); `run` ticks up each
// time the direction flips between inserting and deleting.
export type EditRun = { dir: -1 | 0 | 1; run: number; len: number };

// Advance the edit run for a note whose body just reached `len` characters.
// Typing, then erasing, then typing again flips insert→delete→insert; each flip
// bumps `run`, which the caller folds into the merge key so the three phases
// land as three undo steps (retype → erased → original) instead of coalescing
// into one and losing the erase. A steady direction (or a same-length replace)
// keeps `run`, so an uninterrupted typing burst still collapses to one step.
export function nextEditRun(prev: EditRun | undefined, len: number): EditRun {
  if (!prev) return { dir: 0, run: 0, len };
  const dir: -1 | 0 | 1 = len > prev.len ? 1 : len < prev.len ? -1 : prev.dir;
  const flipped = prev.dir !== 0 && dir !== 0 && dir !== prev.dir;
  return { dir, run: flipped ? prev.run + 1 : prev.run, len };
}

// Apply a stepped-to `DOC_SCOPE` entry onto the live document: restore the note
// *set*, each note's structural fields (`archived` / `folderId`) and the folder
// registry from the timeline entry, but keep the CURRENT body / title /
// attachments of any note that still exists. Those content fields are owned by
// the per-note timelines, so a structural undo/redo must never revert a body
// edit made in a note's own scope afterwards — a note that was deleted and
// re-added by the undo is taken whole from the entry, everything else keeps its
// live content.
export function mergeDocSnapshot(
  current: Snapshot,
  target: Snapshot,
): Snapshot {
  const live = new Map(current.notes.map((n) => [n.id, n]));
  const notes = target.notes.map((t) => {
    const cur = live.get(t.id);
    if (!cur) return t;
    return { ...cur, archived: t.archived, folderId: t.folderId };
  });
  return { ...target, notes };
}

function initialHistoryState(): HistoryState {
  return { scopes: {} };
}

export type RecordParams = {
  /** The note id the edit belongs to, or `DOC_SCOPE` for structural changes. */
  scope: string;
  /** The document before the edit (seeds a scope's timeline on first touch). */
  before: Snapshot;
  /** The document after the edit. */
  after: Snapshot;
  /** A short label describing the action ("Deleted note “Groceries”"). */
  label: string;
  /** Coalesce successive records sharing this key into one undo step. */
  mergeKey?: string | null;
};

export type UndoRedo = {
  /** Record the document produced by a user edit onto its scope's timeline. */
  record: (params: RecordParams) => void;
  /**
   * Drop every timeline. Called whenever the document arrives from outside the
   * edit path (initial / async load, backend swap, conflict resolution adopting
   * the remote) — the old history would otherwise describe edits against a
   * document that's gone. Scopes reseed lazily on their next recorded edit.
   */
  reset: () => void;
  /**
   * Step the active scope back one entry, handing the prior snapshot to `apply`.
   * Returns the label of the action that was reverted, or null at the start of
   * the timeline (a no-op).
   */
  undo: () => string | null;
  /**
   * Step the active scope forward one entry, handing the next snapshot to
   * `apply`. Returns the label of the action re-applied, or null at the end of
   * the timeline (a no-op).
   */
  redo: () => string | null;
  canUndo: boolean;
  canRedo: boolean;
};

export function useUndoRedo(params: {
  /** The scope `undo` / `redo` / `canUndo` / `canRedo` act on right now. */
  activeScope: string;
  /**
   * Apply a stepped-to entry. The caller decides how: a note scope splices the
   * note's content into the live document, `DOC_SCOPE` restores structure via
   * `mergeDocSnapshot`.
   */
  apply: (scope: string, snapshot: Snapshot) => void;
}): UndoRedo {
  const { activeScope, apply } = params;

  // Stable refs so the cursor-move callbacks reach the latest `apply` /
  // `activeScope` without re-subscribing on every render.
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const activeScopeRef = useRef(activeScope);
  activeScopeRef.current = activeScope;

  const [state, dispatch] = useReducer(historyReducer, undefined, () =>
    initialHistoryState(),
  );

  // Ref mirror so undo / redo can read the target entry synchronously before
  // dispatching — reading the closed-over `state` would lag a render behind a
  // freshly recorded entry.
  const stateRef = useRef(state);
  stateRef.current = state;

  const record = useCallback((p: RecordParams) => {
    dispatch({
      kind: "record",
      scope: p.scope,
      before: p.before,
      snapshot: p.after,
      label: p.label,
      mergeKey: p.mergeKey ?? null,
    });
  }, []);

  const reset = useCallback(() => {
    dispatch({ kind: "reset" });
  }, []);

  const undo = useCallback((): string | null => {
    const scope = activeScopeRef.current;
    const timeline = stateRef.current.scopes[scope];
    if (!timeline || timeline.cursor === 0) return null;
    // The label hangs off the entry we're leaving — that entry is the result of
    // the action we're now reverting.
    const undone = timeline.entries[timeline.cursor]!.label;
    applyRef.current(scope, timeline.entries[timeline.cursor - 1]!.snapshot);
    dispatch({ kind: "step", scope, delta: -1 });
    return undone;
  }, []);

  const redo = useCallback((): string | null => {
    const scope = activeScopeRef.current;
    const timeline = stateRef.current.scopes[scope];
    if (!timeline || timeline.cursor >= timeline.entries.length - 1)
      return null;
    const target = timeline.entries[timeline.cursor + 1]!;
    applyRef.current(scope, target.snapshot);
    dispatch({ kind: "step", scope, delta: 1 });
    return target.label;
  }, []);

  const active = state.scopes[activeScope];
  return {
    record,
    reset,
    undo,
    redo,
    canUndo: !!active && active.cursor > 0,
    canRedo: !!active && active.cursor < active.entries.length - 1,
  };
}
