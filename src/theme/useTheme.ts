// Theme engine + appearance store. Holds the user's appearance preferences
// (theme preset, font family + size, and the Custom-theme overrides) in a
// `useSyncExternalStore` store persisted to localStorage, and projects them
// onto `<html>` so the CSS variables in `src/styles/` (and every Tailwind
// utility that resolves through them) follow the picker.
//
// Ported from checklist's `useTheme` + appearance store. Like checklist, the
// settings dialog edits a draft that only persists on Save: while it's open it
// streams the draft through `setAppearancePreview`, the projection paints that
// preview live, and `commitAppearance` / Cancel commit or drop it. Quick
// toggles outside the dialog (the theme switcher) still persist immediately via
// `updateAppearance`. The projection runs as four independent effects so a font
// change doesn't rewrite the colour overrides (and vice versa):
//
//   1. `data-theme` on `<html>` from `theme`. CSS owns the preset palettes;
//      `custom` is a no-op at the CSS layer — effect (4) writes inline
//      overrides instead. While `system` is active the attribute stays
//      `system` and CSS follows `prefers-color-scheme`.
//   2. `--app-font-family` from the selected webfont stack; non-default
//      families are fetched on demand first (font-display: swap).
//   3. `--app-font-scale` multiplier the body font-size reads.
//   4. Custom-theme overrides: the colour vars + radius / density /
//      reduce-motion. Only written when `theme === "custom"` so flipping
//      back to a preset cleans every inline value out of the style
//      attribute.

import { useEffect, useSyncExternalStore } from "react";

import { isCopyScope, isDefaultTitleScheme } from "../domain/note.ts";
import { loadFontFamily } from "./fonts.ts";
import {
  COLOR_KEYS,
  COLOR_KEY_TO_CSS_VAR,
  DEFAULT_CUSTOM_THEME,
  DEFAULT_EDITOR_SETTINGS,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SCALE,
  DEFAULT_THEME,
  FONT_FAMILIES,
  FONT_SCALE_PRESETS,
  isEditorMargin,
  type CustomTheme,
  type DensityPreset,
  type EditorSettings,
  type FontFamilyId,
  type RadiusPreset,
  type ThemePreset,
} from "./themes.ts";

export type {
  CustomTheme,
  CustomThemeColors,
  EditorSettings,
  ThemePreset,
} from "./themes.ts";

// The persisted appearance document — and, since it's the one preferences
// blob that already travels with the synced `settings.json`, the home for the
// achievement state too (so earned trophies follow the user across devices,
// the same way checklist keeps them in its synced `Settings`). The theme
// projection ignores the achievement fields; only the achievements feature
// reads them. Plain JSON so it round-trips through localStorage unchanged.
export type Appearance = {
  theme: ThemePreset;
  fontFamily: FontFamilyId;
  // UI text-size multiplier; one of `FONT_SCALE_PRESETS`.
  fontScale: number;
  customTheme: CustomTheme;
  // Note-writing surface preferences (margins, wrap, live Markdown).
  editor: EditorSettings;
  // Earned achievements: a map of achievement `id` → unlock timestamp (ms
  // epoch). Idempotent — an id already present keeps its first timestamp.
  achievements: Record<string, number>;
  // Achievements unlocked since the user last opened the unlock notification.
  // Drives the trophy button's badge; cleared when that modal is dismissed. A
  // subset of the keys in `achievements`.
  unseenAchievements: string[];
  // Whether the achievements system is switched off. When on, the watcher
  // stops recording unlocks and the header trophy button hides itself.
  // Already-earned achievements are preserved, so flipping it back reveals
  // the same progress.
  disableAchievements: boolean;
};

export const DEFAULT_APPEARANCE: Appearance = {
  theme: DEFAULT_THEME,
  fontFamily: DEFAULT_FONT_FAMILY,
  fontScale: DEFAULT_FONT_SCALE,
  customTheme: DEFAULT_CUSTOM_THEME,
  editor: DEFAULT_EDITOR_SETTINGS,
  achievements: {},
  unseenAchievements: [],
  disableAchievements: false,
};

const STORAGE_KEY = "notes/appearance";
// The key the pared-down engine wrote before the appearance store landed:
// a bare preset string. Read once on boot to carry the old preference over.
const LEGACY_THEME_KEY = "notes/theme";

// Single `--radius` value per preset. "md" sits at the historical default
// (8px); the others fan out around it.
const RADIUS_PX: Record<RadiusPreset, string> = {
  none: "0px",
  sm: "4px",
  md: "8px",
  lg: "16px",
};

// Row padding the `--density-row-py` var feeds. "comfortable" matches the
// pre-existing default.
const DENSITY_ROW_PY: Record<DensityPreset, string> = {
  compact: "0.25rem",
  comfortable: "0.5rem",
  spacious: "0.75rem",
};

const VALID_FONT_FAMILIES = new Set(FONT_FAMILIES.map((f) => f.id));
const VALID_FONT_SCALES = new Set(FONT_SCALE_PRESETS.map((p) => p.scale));

const THEME_SET = new Set<string>([
  "dark",
  "light",
  "dracula",
  "monokai",
  "githubDark",
  "githubLight",
  "solarizedLight",
  "quietLight",
  "excel",
  "system",
  "custom",
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// Coerce a stored value into the achievements map: a plain object whose values
// are finite numbers (unlock timestamps). Anything else is dropped.
function validAchievements(v: unknown): Record<string, number> {
  if (!isRecord(v)) return {};
  const out: Record<string, number> = {};
  for (const [id, ts] of Object.entries(v)) {
    if (typeof ts === "number" && Number.isFinite(ts)) out[id] = ts;
  }
  return out;
}

// Coerce a stored value into the unseen-achievements list: a string array
// narrowed to ids that actually appear in the unlocked map (a stale unseen
// id whose unlock was dropped would otherwise badge the trophy forever).
function validUnseen(v: unknown, unlocked: Record<string, number>): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (id): id is string => typeof id === "string" && unlocked[id] !== undefined,
  );
}

// Coerce arbitrary stored JSON into a valid `Appearance`, falling back to
// the defaults slot-by-slot so a partial or stale document never crashes
// the boot — a forward/backward-compatible read, like checklist's store.
function coerce(raw: unknown): Appearance {
  if (!isRecord(raw)) return DEFAULT_APPEARANCE;
  const theme = raw.theme as ThemePreset;
  const fontFamily = raw.fontFamily as FontFamilyId;
  const fontScale = raw.fontScale as number;
  const custom = isRecord(raw.customTheme) ? raw.customTheme : {};
  const colors = isRecord(custom.colors) ? custom.colors : {};
  const editor = isRecord(raw.editor) ? raw.editor : {};
  const achievements = validAchievements(raw.achievements);
  return {
    theme:
      typeof theme === "string" && (THEME_SET as Set<string>).has(theme)
        ? theme
        : DEFAULT_THEME,
    fontFamily: VALID_FONT_FAMILIES.has(fontFamily)
      ? fontFamily
      : DEFAULT_FONT_FAMILY,
    fontScale: VALID_FONT_SCALES.has(fontScale)
      ? fontScale
      : DEFAULT_FONT_SCALE,
    customTheme: {
      colors: COLOR_KEYS.reduce(
        (acc, k) => {
          const v = colors[k];
          acc[k] = typeof v === "string" ? v : DEFAULT_CUSTOM_THEME.colors[k];
          return acc;
        },
        {} as CustomTheme["colors"],
      ),
      radius:
        typeof custom.radius === "string" &&
        (RADIUS_PX as Record<string, string>)[custom.radius]
          ? (custom.radius as RadiusPreset)
          : DEFAULT_CUSTOM_THEME.radius,
      density:
        typeof custom.density === "string" &&
        (DENSITY_ROW_PY as Record<string, string>)[custom.density]
          ? (custom.density as DensityPreset)
          : DEFAULT_CUSTOM_THEME.density,
      reduceMotion: custom.reduceMotion === true,
    },
    editor: {
      margin: isEditorMargin(editor.margin)
        ? editor.margin
        : DEFAULT_EDITOR_SETTINGS.margin,
      wordWrap:
        typeof editor.wordWrap === "boolean"
          ? editor.wordWrap
          : DEFAULT_EDITOR_SETTINGS.wordWrap,
      renderMarkdown:
        typeof editor.renderMarkdown === "boolean"
          ? editor.renderMarkdown
          : DEFAULT_EDITOR_SETTINGS.renderMarkdown,
      disableSpellcheck: editor.disableSpellcheck === true,
      disableAutocorrect: editor.disableAutocorrect === true,
      trimTrailingSpaces:
        typeof editor.trimTrailingSpaces === "boolean"
          ? editor.trimTrailingSpaces
          : DEFAULT_EDITOR_SETTINGS.trimTrailingSpaces,
      trailingNewline:
        typeof editor.trailingNewline === "boolean"
          ? editor.trailingNewline
          : DEFAULT_EDITOR_SETTINGS.trailingNewline,
      imagesAtEnd: editor.imagesAtEnd === true,
      filesAtEnd: editor.filesAtEnd === true,
      defaultTitle: isDefaultTitleScheme(editor.defaultTitle)
        ? editor.defaultTitle
        : DEFAULT_EDITOR_SETTINGS.defaultTitle,
      copyScope: isCopyScope(editor.copyScope)
        ? editor.copyScope
        : DEFAULT_EDITOR_SETTINGS.copyScope,
    },
    achievements,
    unseenAchievements: validUnseen(raw.unseenAchievements, achievements),
    disableAchievements: raw.disableAchievements === true,
  };
}

function readStored(): Appearance {
  if (typeof localStorage === "undefined") return DEFAULT_APPEARANCE;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      return coerce(JSON.parse(raw));
    } catch {
      return DEFAULT_APPEARANCE;
    }
  }
  // No appearance document yet — carry over the legacy bare-preset key if
  // the user had picked a theme under the old engine.
  const legacy = localStorage.getItem(LEGACY_THEME_KEY);
  if (legacy && THEME_SET.has(legacy)) {
    return { ...DEFAULT_APPEARANCE, theme: legacy as ThemePreset };
  }
  return DEFAULT_APPEARANCE;
}

const listeners = new Set<() => void>();
let current: Appearance = readStored();
// Ephemeral preview override. While the settings dialog is open it streams its
// unsaved draft here so the theme engine repaints live; the persisted `current`
// is left untouched until Save commits it (or Cancel/close drops the preview).
// Only the projection onto `<html>` reads this — every other consumer keeps
// reading the persisted document, so editor/achievement behaviour doesn't shift
// mid-edit and reverts cleanly on Cancel.
let preview: Appearance | null = null;

function emit() {
  for (const l of listeners) l();
}

// The appearance the theme projection should paint: the live preview when one
// is set, otherwise the persisted document.
function effective(): Appearance {
  return preview ?? current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function persist(next: Appearance): void {
  current = next;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  emit();
}

/** Patch one top-level appearance field; the projecting effects apply it. */
export function updateAppearance<K extends keyof Appearance>(
  key: K,
  value: Appearance[K],
): void {
  persist({ ...current, [key]: value });
}

/** The live appearance, read imperatively (e.g. to seed a backend file). */
export function getAppearance(): Appearance {
  return current;
}

/**
 * Stream an unsaved appearance draft to the theme projection so it repaints
 * live, or pass `null` to drop the preview and reassert the persisted look.
 * The settings dialog calls this while open; nothing is persisted.
 */
export function setAppearancePreview(next: Appearance | null): void {
  if (preview === next) return;
  preview = next;
  emit();
}

/**
 * Commit an edited draft from the settings dialog. Persists the owned fields
 * but keeps the live achievement progress (the unlocked map + unseen queue),
 * which the dialog doesn't edit and which may have changed while it was open,
 * then clears any active preview so the committed look takes over without a
 * flash.
 */
export function commitAppearance(next: Appearance): void {
  preview = null;
  persist({
    ...next,
    achievements: current.achievements,
    unseenAchievements: current.unseenAchievements,
  });
}

/**
 * Replace the whole appearance document — the seam the backend settings-store
 * reconciliation writes through when another device's `settings.json` is
 * adopted. Coerces defensively so a stale / partial remote file can't crash
 * the boot.
 */
export function replaceAppearance(raw: unknown): void {
  persist(coerce(raw));
}

/** Subscribe to appearance changes (used to mirror edits to the backend). */
export function subscribeAppearance(listener: () => void): () => void {
  return subscribe(listener);
}

/** Set just the theme preset — the quick-toggle path. */
export function setTheme(theme: ThemePreset): void {
  updateAppearance("theme", theme);
}

/**
 * Record one or more freshly-earned achievements, returning the ids that were
 * genuinely new. Idempotent per id — an id already unlocked keeps its original
 * timestamp and is not re-queued as unseen — so the achievement watcher can
 * call this on every transition without drift. New ids land in both the
 * unlocked map (stamped now) and the unseen queue (so the trophy badges).
 */
export function unlockAchievements(ids: readonly string[]): string[] {
  const now = Date.now();
  const achievements = { ...current.achievements };
  const unseen = [...current.unseenAchievements];
  const newly: string[] = [];
  for (const id of ids) {
    if (achievements[id] !== undefined) continue;
    achievements[id] = now;
    if (!unseen.includes(id)) unseen.push(id);
    newly.push(id);
  }
  if (newly.length === 0) return [];
  persist({ ...current, achievements, unseenAchievements: unseen });
  return newly;
}

/** Clear the unseen-achievements queue (the trophy badge empties). */
export function clearUnseenAchievements(): void {
  if (current.unseenAchievements.length === 0) return;
  persist({ ...current, unseenAchievements: [] });
}

/** Switch the achievements system on or off. */
export function setDisableAchievements(disabled: boolean): void {
  updateAppearance("disableAchievements", disabled);
}

/** Read the persisted appearance and re-render on change. */
export function useAppearance(): Appearance {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULT_APPEARANCE,
  );
}

/**
 * Read the appearance the projection should paint — the live preview while the
 * settings dialog streams a draft, otherwise the persisted document.
 */
function useEffectiveAppearance(): Appearance {
  return useSyncExternalStore(subscribe, effective, () => DEFAULT_APPEARANCE);
}

/**
 * Keep `<html>` in sync with the appearance and return the persisted document.
 * Call once near the root. The projection paints the live preview (so the
 * settings dialog can repaint as the user edits a draft), but the returned
 * value is always the persisted document — so consumers that read editor /
 * achievement settings off it don't shift mid-edit and snap back on Cancel.
 */
export function useApplyAppearance(): Appearance {
  const persisted = useAppearance();
  const { theme, fontFamily, fontScale, customTheme } =
    useEffectiveAppearance();

  // (1) Theme preset attribute.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // (2) Font family stack. Non-default families are fetched lazily (the
  // default `mono` is bundled statically); the stack var is set immediately
  // either way so the fallback paints at once and the webfont swaps in when
  // it lands.
  useEffect(() => {
    const family = FONT_FAMILIES.find((f) => f.id === fontFamily);
    if (!family) return;
    void loadFontFamily(fontFamily);
    document.documentElement.style.setProperty(
      "--app-font-family",
      family.stack,
    );
  }, [fontFamily]);

  // (3) UI text-size multiplier.
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--app-font-scale",
      String(fontScale),
    );
  }, [fontScale]);

  // (4) Custom theme overrides. Only writes inline vars when the active
  // theme is `"custom"`; otherwise clears any prior overrides so flipping
  // back to a preset leaves a clean style attribute.
  useEffect(() => {
    const html = document.documentElement;
    if (theme !== "custom") {
      for (const k of COLOR_KEYS) {
        html.style.removeProperty(`--${COLOR_KEY_TO_CSS_VAR[k]}`);
      }
      html.style.removeProperty("--radius");
      html.style.removeProperty("--density-row-py");
      html.removeAttribute("data-reduce-motion");
      return;
    }
    for (const k of COLOR_KEYS) {
      html.style.setProperty(
        `--${COLOR_KEY_TO_CSS_VAR[k]}`,
        customTheme.colors[k],
      );
    }
    html.style.setProperty("--radius", RADIUS_PX[customTheme.radius]);
    html.style.setProperty(
      "--density-row-py",
      DENSITY_ROW_PY[customTheme.density],
    );
    html.setAttribute(
      "data-reduce-motion",
      customTheme.reduceMotion ? "true" : "false",
    );
  }, [theme, customTheme]);

  return persisted;
}
