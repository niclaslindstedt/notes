import { ACHIEVEMENTS } from "./catalog.ts";
import type { AchState } from "./types.ts";

// Pure: returns the ids of derived-trigger achievements whose predicate
// flipped from false to true on this (prev → next) transition AND that aren't
// already in `alreadyUnlocked`. Manual triggers are skipped — they fire
// through the bus, not the state watcher.
//
// Predicates that declare a `slices` extractor (most do) are skipped when
// every listed slice is referentially unchanged — the hooks keep identity on
// the state island they didn't touch (a note edit replaces only `snapshot`,
// an appearance change only `appearance`), so a note-only edit can't flip an
// appearance-only predicate. Cheap pre-check that avoids the full-snapshot
// walks several predicates do.
export function deriveUnlocks(
  prev: AchState,
  next: AchState,
  alreadyUnlocked: Record<string, number>,
): string[] {
  const fresh: string[] = [];
  for (const ach of ACHIEVEMENTS) {
    if (ach.trigger.kind !== "derived") continue;
    if (alreadyUnlocked[ach.id] !== undefined) continue;
    const trigger = ach.trigger;
    if (trigger.slices) {
      const prevSlices = trigger.slices(prev);
      const nextSlices = trigger.slices(next);
      let changed = false;
      for (let i = 0; i < prevSlices.length; i += 1) {
        if (prevSlices[i] !== nextSlices[i]) {
          changed = true;
          break;
        }
      }
      if (!changed) continue;
    }
    if (trigger.predicate(prev, next)) fresh.push(ach.id);
  }
  return fresh;
}
