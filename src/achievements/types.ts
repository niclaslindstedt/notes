// Achievement model. Every feature in the app doubles as an unlockable
// trophy; this is the shape the catalog, the derive helper, and the watcher
// share. A predicate sees an `AchState` snapshot bundling the two state
// islands an unlock can hinge on — the persisted note document (`Snapshot`)
// and the synced appearance/preferences (`Appearance`, which also carries the
// unlock map). Everything that lives outside those two — connecting a folder
// or cloud, turning encryption on, creating a namespace, installing the PWA,
// undoing, reloading from the backend — fires through the manual bus instead.

import type { Snapshot } from "../domain/note.ts";
import type { Appearance } from "../theme/useTheme.ts";
import type { Glyph } from "./glyphs.tsx";

// Four tiers that mirror the four stages of growing into the app — from "just
// opened it" to "bending it to my workflow". Point values are uniform per
// tier so the catalog stays easy to balance as it grows.
export type AchievementTier = "beginner" | "intermediate" | "pro" | "expert";

export const TIER_POINTS: Record<AchievementTier, number> = {
  beginner: 10,
  intermediate: 25,
  pro: 50,
  expert: 100,
};

export const TIER_ORDER: readonly AchievementTier[] = [
  "beginner",
  "intermediate",
  "pro",
  "expert",
];

// The two state islands a derived predicate can read. The hooks preserve
// referential identity on the slice they didn't touch (a note edit replaces
// only `snapshot`, an appearance change only `appearance`), so the `slices`
// pre-check below stays cheap.
export type AchState = {
  snapshot: Snapshot;
  appearance: Appearance;
};

// Two kinds of unlock trigger:
//
// - `derived` — the watcher receives every (prev, next) `AchState`
//   transition and runs each `predicate`. When the predicate flips from false
//   to true on this transition, the unlock fires. The predicate sees the full
//   pre- and post-transition state, so it can spot "this user just wrote
//   their first note", "this user just switched theme", etc.
//
// - `manual` — the trigger lives outside the document / appearance state
//   (folder/cloud connect, encryption, namespace create, install, undo,
//   reload). Callers fire the unlock by calling `unlock(id)` from
//   `src/achievements`; the bus holds it until the watcher mounted in App is
//   ready to record it.
export type Trigger =
  | {
      kind: "derived";
      predicate: (prev: AchState, next: AchState) => boolean;
      // Optional slice extractor. When provided, `deriveUnlocks` invokes the
      // predicate only when at least one returned reference differs between
      // prev and next — so an appearance-only change skips every snapshot
      // predicate without running it, and vice versa. Each slice listed must
      // be one the predicate actually reads, or a relevant change would be
      // silently filtered out.
      slices?: (state: AchState) => readonly unknown[];
    }
  | { kind: "manual" };

export type Achievement = {
  // Stable string id — once shipped, never renamed. Used as the key inside
  // `Appearance.achievements` and the bus's pending queue, as the React key
  // in catalog renders, and as the path segment in the i18n catalog
  // (`achievements.catalog.<id>.{name,condition,learnMore}`) the renderer
  // looks the display copy up by.
  id: string;
  tier: AchievementTier;
  glyph: Glyph;
  // Whether the i18n catalog carries a `learnMore` key for this id. The
  // expanded body is shown inside a per-achievement `<details>` in the tour;
  // not every trophy needs depth beyond its condition, so each entry declares
  // the presence here and the renderer reads through it instead of probing
  // the catalog at runtime.
  learnMore?: boolean;
  trigger: Trigger;
};
