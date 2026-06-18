// In-memory undo / redo over whole-document snapshots, ported from
// checklist's `use-undo-redo`. Each user edit records the resulting
// `Snapshot` together with a short human label describing the action that
// produced it; undo / redo walk a cursor back and forth over the recorded
// states, hand the target snapshot to `setData` so the outer hook's React
// state stays in agreement with the cursor, and return the label of the
// action they reverted / re-applied so a caller can announce it.
//
// Because a snapshot is the *entire* document (the whole list of notes), a
// deleted note still lives in the prior entry — that's what lets "undo"
// bring it back.
//
// One adaptation for the notes domain: a note's body is edited continuously,
// one keystroke at a time, so recording every `update` verbatim would flood
// the timeline with a separate entry per character. Edits carry an optional
// `mergeKey` (e.g. `edit:<noteId>`); when the newest entry shares the same
// key, a fresh record *replaces* it in place rather than appending. A whole
// editing session of one note therefore collapses to a single undo step,
// while a `create` / `remove` (no key) always lands as its own step and
// breaks the coalescing chain. The textarea's native undo still handles
// character-level reverts *within* a session.

import { useCallback, useReducer, useRef } from "react";

import type { Snapshot } from "../domain/note.ts";

// Maximum number of past states retained. Snapshots share structure with
// their neighbours (a mutation rebuilds only the touched note), so unchanged
// notes are not duplicated across entries.
const UNDO_HISTORY_LIMIT = 50;

// One step on the timeline: the document as it stood after an action, paired
// with the label of the action that produced it and an optional merge key
// (set for coalescable continuous edits). The seed entry (the document as
// loaded) has no originating action, so its label is null and undo never
// announces it.
type HistoryEntry = {
  snapshot: Snapshot;
  label: string | null;
  mergeKey: string | null;
};

type HistoryState = {
  entries: HistoryEntry[];
  cursor: number;
};

// Named transitions kept pure: the side effect of swapping the visible
// document to the target snapshot lives in the caller, which reads the
// target off `stateRef` and pairs each cursor move with a `setData`.
type HistoryAction =
  | { kind: "reset"; seed: Snapshot }
  | {
      kind: "record";
      snapshot: Snapshot;
      label: string;
      mergeKey: string | null;
    }
  // Move the cursor by ±1, clamped at the timeline edges — the bounds check
  // is what makes undo / redo no-ops at the ends.
  | { kind: "step"; delta: -1 | 1 };

function historyReducer(
  state: HistoryState,
  action: HistoryAction,
): HistoryState {
  switch (action.kind) {
    case "reset":
      return initialHistoryState(action.seed);
    case "record": {
      // Coalesce a continuous edit into the newest entry when the cursor sits
      // at the head and that entry shares the merge key — successive
      // keystrokes in one note collapse to a single undo step.
      const atHead = state.cursor === state.entries.length - 1;
      const head = state.entries[state.cursor];
      if (
        atHead &&
        action.mergeKey !== null &&
        head &&
        head.mergeKey === action.mergeKey
      ) {
        const merged = state.entries.slice();
        merged[state.cursor] = {
          snapshot: action.snapshot,
          label: action.label,
          mergeKey: action.mergeKey,
        };
        return { entries: merged, cursor: state.cursor };
      }
      // Drop any "future" entries beyond the cursor — a fresh edit overwrites
      // the redo timeline. Append, then trim from the front if the past
      // portion would exceed the retention limit.
      const truncated = state.entries.slice(0, state.cursor + 1);
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
    case "step": {
      const next = state.cursor + action.delta;
      if (next < 0 || next >= state.entries.length) return state;
      return { entries: state.entries, cursor: next };
    }
  }
}

function initialHistoryState(seed: Snapshot): HistoryState {
  return {
    entries: [{ snapshot: seed, label: null, mergeKey: null }],
    cursor: 0,
  };
}

export type UndoRedo = {
  /**
   * Record the document produced by a user edit as the newest entry, tagged
   * with a label describing the action ("Deleted note “Groceries”"). Pass a
   * `mergeKey` for continuous edits (e.g. `edit:<noteId>`) so successive
   * records to the same target collapse into one undo step.
   */
  record: (snapshot: Snapshot, label: string, mergeKey?: string | null) => void;
  /**
   * Replace the timeline with a fresh seed. Called whenever the document
   * arrives from outside the edit path (initial / async load, backend swap,
   * conflict resolution adopting the remote) — the old history would
   * otherwise describe edits against a document that's gone.
   */
  reset: (seed: Snapshot) => void;
  /**
   * Step back one entry, applying the prior snapshot via `setData`. Returns
   * the label of the action that was reverted, or null at the start of the
   * timeline (a no-op).
   */
  undo: () => string | null;
  /**
   * Step forward one entry, re-applying the next snapshot via `setData`.
   * Returns the label of the action that was re-applied, or null at the end
   * of the timeline (a no-op).
   */
  redo: () => string | null;
  canUndo: boolean;
  canRedo: boolean;
};

export function useUndoRedo(params: {
  initialSeed: Snapshot;
  setData: (next: Snapshot) => void;
}): UndoRedo {
  const { initialSeed, setData } = params;

  // Stable ref so the cursor-move callbacks reach the latest `setData`
  // without re-subscribing on every render.
  const setDataRef = useRef(setData);
  setDataRef.current = setData;

  const [state, dispatch] = useReducer(
    historyReducer,
    initialSeed,
    initialHistoryState,
  );

  // Ref mirror so undo / redo can read the target entry synchronously before
  // dispatching — reading the closed-over `state` would lag a render behind a
  // freshly recorded entry.
  const stateRef = useRef(state);
  stateRef.current = state;

  const record = useCallback(
    (snapshot: Snapshot, label: string, mergeKey: string | null = null) => {
      dispatch({ kind: "record", snapshot, label, mergeKey });
    },
    [],
  );

  const reset = useCallback((seed: Snapshot) => {
    dispatch({ kind: "reset", seed });
  }, []);

  const undo = useCallback((): string | null => {
    const cur = stateRef.current;
    if (cur.cursor === 0) return null;
    // The label hangs off the entry we're leaving — that entry is the result
    // of the action we're now reverting.
    const undone = cur.entries[cur.cursor]!.label;
    setDataRef.current(cur.entries[cur.cursor - 1]!.snapshot);
    dispatch({ kind: "step", delta: -1 });
    return undone;
  }, []);

  const redo = useCallback((): string | null => {
    const cur = stateRef.current;
    if (cur.cursor >= cur.entries.length - 1) return null;
    const target = cur.entries[cur.cursor + 1]!;
    setDataRef.current(target.snapshot);
    dispatch({ kind: "step", delta: 1 });
    return target.label;
  }, []);

  return {
    record,
    reset,
    undo,
    redo,
    canUndo: state.cursor > 0,
    canRedo: state.cursor < state.entries.length - 1,
  };
}
