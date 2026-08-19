// Which width the settings dialog's Save and Reset buttons act at when they
// are pressed without opening their menu. A per-device preference in the
// plainest sense — it is about how *this* person drives the dialog, not about
// what any setting is — so it lives in localStorage and never syncs anywhere.
//
// Remembering it is what makes the split buttons worth having: someone who
// keeps their preferences on their own device sets the Save scope to `device`
// once and then just presses Save, instead of re-picking from the menu on
// every visit.

import {
  isSettingsScope,
  type SettingsScope,
} from "../../theme/appearance-scopes.ts";

const SAVE_KEY = "notes:settings:save-scope";
const RESET_KEY = "notes:settings:reset-scope";

/** Where a Reset can send the draft: a width, or the built-in defaults. */
export type ResetTarget = SettingsScope | "defaults";

export function isResetTarget(value: unknown): value is ResetTarget {
  return value === "defaults" || isSettingsScope(value);
}

function read(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  } catch {
    // Quota / private mode — the default just isn't remembered.
  }
}

/**
 * The width Save acts at. Defaults to `global`, which is where every setting
 * lived before there were widths — so an install that never opens the menu
 * behaves exactly as it always did.
 */
export function getSaveScope(): SettingsScope {
  const raw = read(SAVE_KEY);
  return isSettingsScope(raw) ? raw : "global";
}

export function setSaveScope(scope: SettingsScope): void {
  write(SAVE_KEY, scope);
}

/** What Reset falls back to. Defaults to the built-in defaults. */
export function getResetTarget(): ResetTarget {
  const raw = read(RESET_KEY);
  return isResetTarget(raw) ? raw : "defaults";
}

export function setResetTarget(target: ResetTarget): void {
  write(RESET_KEY, target);
}
