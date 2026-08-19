// Which *width* a setting is saved at, and what that means for the appearance
// document. The generic algebra lives in `src/domain/settings-layers.ts`; this
// module binds it to the app's three scopes and to `Appearance`.
//
// A namespace can be shared by several people — the "one Dropbox login, one
// shared folder" arrangement — so a single settings document per account is
// not enough: one person switching to a light theme would repaint everyone
// else's app. Three widths solve it, narrowest winning:
//
//   global    → `settings.json` at the app-folder root. Everyone on the
//               account, in every namespace. The historical home, so an
//               existing install reads back unchanged.
//   namespace → `namespace-settings.json` inside the namespace's own folder.
//               Everyone who uses that namespace, and nobody else. Travels
//               with a namespace folder that is shared wholesale.
//   device    → localStorage on this install only. Never uploaded, so it is
//               the width that keeps one person's choices off everybody
//               else's screen.
//
// Each layer is **sparse** — it holds only the leaves it has an opinion about.
// That is what makes the stack work: saving one toggle to the device width
// records that one leaf, and every other setting keeps following the wider
// layers. Saving a leaf whose value already equals the wider resolution
// records nothing at all (the layer *drops* it), which is how a setting stops
// being overridden.
//
// Three keys sit outside the whole scheme (`UNSCOPED_KEYS`): the Transform
// rules and the two achievement fields. They are authored content and earned
// progress rather than preferences — and the rules already carry a namespace
// of their own — so they always live in the global layer, exactly where they
// have always lived.

import {
  changedPaths,
  deletePath,
  getPath,
  isEmptyLayer,
  jsonEqual,
  mergeLayers,
  setPath,
  type Layer,
  type LeafPath,
} from "../domain/settings-layers.ts";

/** The three widths a setting can be written at, widest first. */
export const SETTINGS_SCOPES = ["global", "namespace", "device"] as const;

export type SettingsScope = (typeof SETTINGS_SCOPES)[number];

/** One sparse layer per scope. */
export type AppearanceLayers = Record<SettingsScope, Layer>;

export const EMPTY_APPEARANCE_LAYERS: AppearanceLayers = {
  global: {},
  namespace: {},
  device: {},
};

/**
 * Appearance keys that never take part in scoping: they always live in the
 * global layer. See the module comment — authored content and earned
 * progress, not preferences.
 */
export const UNSCOPED_KEYS = [
  "transforms",
  "achievements",
  "unseenAchievements",
] as const;

const UNSCOPED = new Set<string>(UNSCOPED_KEYS);

/** Whether a leaf path belongs to one of the unscoped keys. */
export function isUnscopedPath(path: LeafPath): boolean {
  return UNSCOPED.has(path.split(".")[0] ?? path);
}

export function isSettingsScope(value: unknown): value is SettingsScope {
  return (
    typeof value === "string" &&
    (SETTINGS_SCOPES as readonly string[]).includes(value)
  );
}

/** The scopes narrower than `scope` (device is narrower than namespace, …). */
export function narrowerScopes(scope: SettingsScope): SettingsScope[] {
  return SETTINGS_SCOPES.slice(SETTINGS_SCOPES.indexOf(scope) + 1);
}

/** The whole stack resolved: defaults, then every layer widest to narrowest. */
export function resolveAppearanceLayers(
  defaults: Layer,
  layers: AppearanceLayers,
): Layer {
  return mergeLayers(defaults, ...SETTINGS_SCOPES.map((s) => layers[s]));
}

/**
 * The stack resolved down to (and including) `scope` — what a value would
 * fall back to if every narrower layer gave up its opinion. This is what
 * "Reset → Namespace settings" loads into the draft.
 */
export function resolveThroughScope(
  defaults: Layer,
  layers: AppearanceLayers,
  scope: SettingsScope,
): Layer {
  const upTo = SETTINGS_SCOPES.slice(0, SETTINGS_SCOPES.indexOf(scope) + 1);
  return mergeLayers(defaults, ...upTo.map((s) => layers[s]));
}

/** The stack resolved *above* `scope` — the baseline a save at `scope` diffs against. */
function resolveAboveScope(
  defaults: Layer,
  layers: AppearanceLayers,
  scope: SettingsScope,
): Layer {
  const wider = SETTINGS_SCOPES.slice(0, SETTINGS_SCOPES.indexOf(scope));
  return mergeLayers(defaults, ...wider.map((s) => layers[s]));
}

/** Whether a scope currently holds any setting at all — the Reset menu's gate. */
export function scopeHoldsSettings(
  layers: AppearanceLayers,
  scope: SettingsScope,
): boolean {
  return !isEmptyLayer(layers[scope]);
}

/**
 * Commit a settings-dialog draft at one width.
 *
 * Only the leaves the user actually moved since the dialog opened are written
 * — `baseline` is the resolved appearance at open time — so saving at the
 * global width never drags along every untouched value and republishes it to
 * everyone. For each moved leaf:
 *
 *   - it is stored in `scope`'s layer, unless it already equals what the wider
 *     layers resolve to, in which case it is *removed* from that layer (the
 *     setting stops being an override and starts following the wider width
 *     again — this is how Reset-to-a-wider-scope followed by Save clears an
 *     override);
 *   - it is removed from every **narrower** layer, because a leaf that stayed
 *     behind there would shadow the save and the user would watch their choice
 *     do nothing.
 *
 * Layers wider than `scope` are never touched, and neither is any leaf the
 * user didn't move.
 */
export function applyScopedSave(
  defaults: Layer,
  layers: AppearanceLayers,
  scope: SettingsScope,
  draft: Layer,
  baseline: Layer,
): AppearanceLayers {
  const above = resolveAboveScope(defaults, layers, scope);
  const narrower = narrowerScopes(scope);
  const next: AppearanceLayers = { ...layers };
  let target = layers[scope];

  for (const path of changedPaths(baseline, draft)) {
    if (isUnscopedPath(path)) continue;
    const value = getPath(draft, path);
    target = jsonEqual(value, getPath(above, path))
      ? deletePath(target, path)
      : setPath(target, path, value);
    for (const scopeBelow of narrower) {
      next[scopeBelow] = deletePath(next[scopeBelow], path);
    }
  }

  next[scope] = target;
  return next;
}

/**
 * Write one already-resolved value into whichever layer currently owns it,
 * falling back to `fallback` when no layer has an opinion yet. This is the
 * path the quick toggles outside the settings dialog take (the theme
 * switcher, the achievement recorder): they have no scope picker, so they
 * keep a setting at the width it is already being managed at instead of
 * silently promoting or demoting it.
 */
export function writeToOwningScope(
  layers: AppearanceLayers,
  path: LeafPath,
  value: unknown,
  fallback: SettingsScope = "global",
): AppearanceLayers {
  const owner =
    [...SETTINGS_SCOPES]
      .reverse()
      .find((scope) => getPath(layers[scope], path) !== undefined) ?? fallback;
  return { ...layers, [owner]: setPath(layers[owner], path, value) };
}
