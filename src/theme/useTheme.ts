// Appearance store + the projection mount.
//
// Holds the user's appearance preferences (theme preset, font family + size,
// and the Custom-theme overrides) in a `useSyncExternalStore` store persisted
// to localStorage. The projection itself — painting those values onto `<html>`
// as CSS variables, so `src/styles/` and every Tailwind utility that resolves
// through them follow the picker — is the framework's shared theme engine
// (`useApplyTheme` from `@niclaslindstedt/oss-framework/theme`); this module
// keeps only the *store*, which is fused with app-only concerns the framework
// knows nothing about (editor / list / sidebar preferences and the synced
// achievements map).
//
// The store is the part the framework deliberately leaves app-side. Like
// checklist, the settings dialog edits a draft that only persists on Save:
// while it's open it streams the draft through `setAppearancePreview`, the
// projection paints that preview live, and `commitAppearance` / Cancel commit
// or drop it. Quick toggles outside the dialog (the theme switcher) still
// persist immediately via `updateAppearance`. `useApplyAppearance` feeds the
// effective (preview-or-persisted) appearance to the engine and returns the
// persisted document, so consumers that read editor / achievement settings off
// it don't shift mid-edit and snap back on Cancel.

import { useSyncExternalStore } from "react";

import { useApplyTheme } from "@niclaslindstedt/oss-framework/theme";
import { isCopyScope, isDefaultTitleScheme } from "../domain/note.ts";
import {
  coerceCustomTheme,
  DEFAULT_CUSTOM_THEME,
  DEFAULT_EDITOR_SETTINGS,
  DEFAULT_FOLDER_PLACEMENT,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SCALE,
  DEFAULT_LIST_LAYOUT,
  DEFAULT_NOTE_SORT_KEY,
  DEFAULT_THEME,
  isEditorMargin,
  isFolderPlacement,
  isFontFamily,
  isFontScale,
  isListLayout,
  isNoteSortKey,
  isThemePreset,
  LINK_SHORTEN_LENGTHS,
  type CustomTheme,
  type EditorSettings,
  type FolderPlacement,
  type FontFamilyId,
  type ListLayout,
  type NoteSortKey,
  type ThemePreset,
} from "./themes.ts";

export type {
  CustomTheme,
  CustomThemeColors,
  EditorSettings,
  FolderPlacement,
  ListLayout,
  NoteSortKey,
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
  // How the overview lays each note out — a compact one-line `rows` list or
  // the taller, multi-line `cards` treatment.
  listLayout: ListLayout;
  // Where the side menu places folders relative to the loose notes — pinned
  // above them (`top`) or interleaved with them in sort order (`mixed`).
  folderPlacement: FolderPlacement;
  // What the side menu sorts notes (and, under `mixed`, folders) by — most
  // recently modified, or alphabetically by name.
  noteSortKey: NoteSortKey;
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
  listLayout: DEFAULT_LIST_LAYOUT,
  folderPlacement: DEFAULT_FOLDER_PLACEMENT,
  noteSortKey: DEFAULT_NOTE_SORT_KEY,
  editor: DEFAULT_EDITOR_SETTINGS,
  achievements: {},
  unseenAchievements: [],
  disableAchievements: false,
};

const STORAGE_KEY = "notes/appearance";
// The key the pared-down engine wrote before the appearance store landed:
// a bare preset string. Read once on boot to carry the old preference over.
const LEGACY_THEME_KEY = "notes/theme";

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
  const editor = isRecord(raw.editor) ? raw.editor : {};
  const achievements = validAchievements(raw.achievements);
  return {
    theme: isThemePreset(raw.theme) ? raw.theme : DEFAULT_THEME,
    fontFamily: isFontFamily(raw.fontFamily)
      ? raw.fontFamily
      : DEFAULT_FONT_FAMILY,
    fontScale: isFontScale(raw.fontScale) ? raw.fontScale : DEFAULT_FONT_SCALE,
    // The framework owns the Custom-theme shape (eighteen colour slots + the
    // shape / motion presets); its coercion fills any missing or malformed
    // slot from `DEFAULT_CUSTOM_THEME`, so a legacy eleven-slot document (or a
    // partial / stale remote one) is upgraded in place rather than crashing
    // the boot. notes only edits the eleven slots it paints; the rest ride at
    // their seeded defaults.
    customTheme: coerceCustomTheme(raw.customTheme),
    listLayout: isListLayout(raw.listLayout)
      ? raw.listLayout
      : DEFAULT_LIST_LAYOUT,
    folderPlacement: isFolderPlacement(raw.folderPlacement)
      ? raw.folderPlacement
      : DEFAULT_FOLDER_PLACEMENT,
    noteSortKey: isNoteSortKey(raw.noteSortKey)
      ? raw.noteSortKey
      : DEFAULT_NOTE_SORT_KEY,
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
      shortenLinkChars: LINK_SHORTEN_LENGTHS.includes(
        editor.shortenLinkChars as number,
      )
        ? (editor.shortenLinkChars as number)
        : DEFAULT_EDITOR_SETTINGS.shortenLinkChars,
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
  if (isThemePreset(legacy)) {
    return { ...DEFAULT_APPEARANCE, theme: legacy };
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

  // The shared engine runs the four independent projecting effects: it sets
  // `data-theme`, the `--app-font-family` stack (lazily fetching a non-default
  // webfont), the `--app-font-scale` multiplier, and — only while
  // `theme === "custom"` — the inline colour / radius / density / border-width
  // vars and the `data-reduce-motion` attribute, clearing them again the
  // moment the user switches back to a preset. notes paints eleven of the
  // eighteen custom colour vars (`src/styles/palettes.css` + `theme.css`) and
  // reads `--density-row-py` + `--radius` (aliased to `--radius-md`); the rest
  // of the vars the engine writes are inert here.
  useApplyTheme({ theme, fontFamily, fontScale, customTheme });

  return persisted;
}
