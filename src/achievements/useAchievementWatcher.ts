import { useEffect, useRef } from "react";

import type { Snapshot } from "../domain/note.ts";
import type { Appearance } from "../theme/useTheme.ts";
import { drain, subscribe } from "./bus.ts";
import { ACHIEVEMENT_BY_ID } from "./catalog.ts";
import { deriveUnlocks } from "./derive.ts";
import type { AchState } from "./types.ts";

export type AchievementWatcher = {
  /** The persisted note document — half of the derived-predicate input. */
  snapshot: Snapshot;
  /** The synced appearance/preferences — the other half, and the unlock store. */
  appearance: Appearance;
  /**
   * False until the active backend's first async load has resolved. Holds
   * both passes off so loading a saved document / settings never backfills
   * unlocks for things the user already had — only deltas produced after the
   * watcher is live count ("forward-going only").
   */
  loaded: boolean;
  /**
   * False when the user has switched achievements off. Both passes no-op while
   * disabled — no derived unlocks, and the manual bus is drained-and-discarded
   * so nothing queued mid-disable fires on re-enable. Re-enabling
   * re-establishes the baseline (like a fresh load) so the user's deltas only
   * count forward-going, never as a retroactive backfill.
   */
  enabled: boolean;
  /**
   * Record freshly-earned ids (idempotent per id), returning the ids that were
   * genuinely new — `unlockAchievements` from the appearance store.
   */
  record: (ids: readonly string[]) => string[];
};

// Mounted once inside App. Two responsibilities:
//
// 1. After every (snapshot|appearance) transition, run `deriveUnlocks` and
//    record each id whose predicate just flipped true. The pre-`loaded`
//    renders are absorbed into the baseline (prevRef tracks the current
//    state) so the seed → backend-load swap never fires backfill unlocks.
//
// 2. Subscribe to the manual-unlock bus and drain queued ids on each
//    notification, recording them the same way. Lets callers outside the
//    watcher's subtree (the storage backend, the side menu's undo) record an
//    unlock by calling `unlock(id)` — no prop drilling.
export function useAchievementWatcher({
  snapshot,
  appearance,
  loaded,
  enabled,
  record,
}: AchievementWatcher): void {
  const prevRef = useRef<AchState | null>(null);
  // Tracks whether the previous derived-pass render saw `loaded === true`. The
  // render where `loaded` first flips true also carries the hydrated document
  // (the backend load swaps the doc and flips the flag in one batch), so that
  // render must only *establish* the baseline, never derive — otherwise the
  // seed → hydrated jump backfills every unlock the user already had. Reset to
  // false whenever `loaded` drops (a backend swap) so the next load
  // re-baselines the same way.
  const wasLoaded = useRef(false);

  // Keep the latest record reachable from the bus subscription without
  // re-subscribing on every render.
  const recordRef = useRef(record);
  recordRef.current = record;

  // Drain the manual-unlock bus. Re-runs whenever a manual `unlock()` arrives
  // or the unlock map changes (so the recorded id checks against the latest
  // map). Held off until `loaded`.
  useEffect(() => {
    if (!loaded) return;
    const consume = () => {
      // Always drain first so a disabled watcher still empties the bus rather
      // than letting unlocks pile up to fire the moment it's re-enabled.
      const ids = drain().filter((id) => ACHIEVEMENT_BY_ID.has(id));
      if (ids.length === 0 || !enabled) return;
      recordRef.current(ids);
    };
    // Drain anything queued before the listener attached (e.g. an unlock fired
    // during boot while data was still loading).
    consume();
    return subscribe(consume);
  }, [loaded, enabled, appearance.achievements]);

  // Derived-trigger pass on every state delta. While loading, keep prevRef
  // aligned with the current state so the first post-load comparison treats
  // the hydrated state as the baseline rather than the placeholder seed.
  useEffect(() => {
    const nextState: AchState = { snapshot, appearance };
    // Treat "disabled" exactly like "not loaded": keep the baseline aligned
    // with the live state and drop the loaded flag so re-enabling re-baselines
    // and never backfills the deltas produced while it was off.
    if (!loaded || !enabled) {
      prevRef.current = nextState;
      wasLoaded.current = false;
      return;
    }
    const justLoaded = !wasLoaded.current;
    wasLoaded.current = true;
    const prev = prevRef.current;
    prevRef.current = nextState;
    // The first render after the backend load (or a backend swap) only sets
    // the baseline — the hydrated state is "what the user already had", not a
    // delta they just produced.
    if (justLoaded) return;
    if (prev === null) return;
    if (prev.snapshot === snapshot && prev.appearance === appearance) return;
    const fresh = deriveUnlocks(prev, nextState, appearance.achievements);
    if (fresh.length === 0) return;
    recordRef.current(fresh);
  }, [snapshot, appearance, loaded, enabled]);
}
