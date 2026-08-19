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
// `updateAppearance`.
//
// **The document is not one document.** It resolves from three sparse layers —
// global, namespace, device — because a namespace can be shared by several
// people through one login, and a single account-wide settings file would mean
// one of them repainting everyone else's app. `./appearance-scopes.ts` owns
// what each width means; this module holds the layers, resolves them, and is
// the only place that writes them. Every consumer keeps reading one flat
// `Appearance`, so nothing downstream had to learn about scopes.
//
// The projection runs as four independent effects so a font change doesn't
// rewrite the colour overrides (and vice versa):
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
import {
  DEFAULT_MASK_STYLE,
  DEFAULT_TRANSFORM_KIND,
  isMaskStyle,
  isTransformKind,
  type TransformRule,
} from "../domain/transform.ts";
import { getActiveNamespaceSlug } from "../storage/namespaces.ts";
import {
  isEmptyLayer,
  jsonEqual,
  setPath,
  type Layer,
} from "../domain/settings-layers.ts";
import {
  applyScopedSave,
  resolveAppearanceLayers,
  resolveThroughScope,
  writeToOwningScope,
  type AppearanceLayers,
  type SettingsScope,
} from "./appearance-scopes.ts";
import { loadFontFamily } from "./fonts.ts";
import {
  COLOR_KEYS,
  COLOR_KEY_TO_CSS_VAR,
  coercePdfSettings,
  DEFAULT_CUSTOM_THEME,
  DEFAULT_EDITOR_SETTINGS,
  DEFAULT_PDF_SETTINGS,
  DEFAULT_FAVORITES_SHOW_FOLDERS,
  DEFAULT_FOLDER_PLACEMENT,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SCALE,
  DEFAULT_LIST_LAYOUT,
  DEFAULT_NOTE_SORT_KEY,
  DEFAULT_THEME,
  FONT_FAMILIES,
  FONT_SCALE_PRESETS,
  isEditorMargin,
  isFolderPlacement,
  isListLayout,
  isNoteSortKey,
  LINK_SHORTEN_LENGTHS,
  type CustomTheme,
  type DensityPreset,
  type EditorSettings,
  type FolderPlacement,
  type FontFamilyId,
  type ListLayout,
  type NoteSortKey,
  type PdfSettings,
  type RadiusPreset,
  type ThemePreset,
} from "./themes.ts";

export type {
  CustomTheme,
  CustomThemeColors,
  EditorSettings,
  FolderPlacement,
  ListLayout,
  NoteSortKey,
  PdfSettings,
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
  // Whether the side menu's **Favorites** section reproduces the folders the
  // starred notes are filed in. Off by default: Favorites is a shortcut list,
  // so it flattens the hierarchy away and lists the notes themselves.
  favoritesShowFolders: boolean;
  // Note-writing surface preferences (margins, wrap, live Markdown).
  editor: EditorSettings;
  // The **Transform** rules: regexes that rewrite what a note body shows —
  // an issue number into a link, a phone number into a mask. Display-only;
  // the stored note keeps what was typed. Order is significant (the first
  // rule to claim a run of text wins), so this is a list, not a map.
  //
  // Every rule carries the namespace it runs in (or `null` for all of them),
  // and the list holds the rules of every namespace: this document is the one
  // `settings.json` at the app-folder root, shared by every namespace, so a
  // work rule travels with the folder even while the home notes are open.
  transforms: TransformRule[];
  // How the export function lays a note out on paper — page size, margins,
  // fonts, code styling, bullet glyph. Read only by the PDF renderer.
  pdf: PdfSettings;
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
  favoritesShowFolders: DEFAULT_FAVORITES_SHOW_FOLDERS,
  editor: DEFAULT_EDITOR_SETTINGS,
  transforms: [],
  pdf: DEFAULT_PDF_SETTINGS,
  achievements: {},
  unseenAchievements: [],
  disableAchievements: false,
};

// The **global** layer's localStorage home. Historically this key held the
// whole appearance document, which is exactly what a global layer with an
// opinion about every leaf looks like — so an existing install reads back
// unchanged and keeps syncing through `settings.json` as before.
const STORAGE_KEY = "notes/appearance";
// The **device** layer: the settings this install keeps to itself. Never
// uploaded to any backend, which is what makes it safe on a shared login.
const DEVICE_STORAGE_KEY = "notes/appearance:device";
// The **namespace** layer's per-slug cache, mirroring the namespace's own
// `namespace-settings.json`. Suffixed by slug so switching namespaces swaps
// the layer without a round-trip, and so first paint has it before any
// network resolves.
const NAMESPACE_STORAGE_PREFIX = "notes/appearance:ns:";
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

// Coerce a stored value into the Transform rule list: an array of records,
// each of which must at least carry an id and a pattern (a rule with neither
// can never match anything, so it's dropped rather than repaired). Every other
// field falls back to the blank rule's default, slot by slot.
function validTransforms(v: unknown): TransformRule[] {
  if (!Array.isArray(v)) return [];
  const out: TransformRule[] = [];
  for (const raw of v) {
    if (!isRecord(raw)) continue;
    const { id, pattern } = raw;
    if (typeof id !== "string" || id === "") continue;
    if (typeof pattern !== "string" || pattern === "") continue;
    out.push({
      id,
      pattern,
      // A rule written before scoping existed carries no `namespace`, and a
      // rule from an older build that dropped the field reads back the same
      // way: null, meaning it runs in every namespace — which is exactly what
      // it did before.
      namespace:
        typeof raw.namespace === "string" && raw.namespace !== ""
          ? raw.namespace
          : null,
      name: typeof raw.name === "string" ? raw.name : "",
      ignoreCase: raw.ignoreCase === true,
      kind: isTransformKind(raw.kind) ? raw.kind : DEFAULT_TRANSFORM_KIND,
      replacement: typeof raw.replacement === "string" ? raw.replacement : "",
      mask: isMaskStyle(raw.mask) ? raw.mask : DEFAULT_MASK_STYLE,
      sample: typeof raw.sample === "string" ? raw.sample : "",
      enabled: raw.enabled !== false,
    });
  }
  return out;
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
    listLayout: isListLayout(raw.listLayout)
      ? raw.listLayout
      : DEFAULT_LIST_LAYOUT,
    folderPlacement: isFolderPlacement(raw.folderPlacement)
      ? raw.folderPlacement
      : DEFAULT_FOLDER_PLACEMENT,
    noteSortKey: isNoteSortKey(raw.noteSortKey)
      ? raw.noteSortKey
      : DEFAULT_NOTE_SORT_KEY,
    favoritesShowFolders:
      typeof raw.favoritesShowFolders === "boolean"
        ? raw.favoritesShowFolders
        : DEFAULT_FAVORITES_SHOW_FOLDERS,
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
      lineNumbers: editor.lineNumbers === true,
      disableSpellcheck: editor.disableSpellcheck === true,
      disableAutocorrect: editor.disableAutocorrect === true,
      capitaliseSentences:
        typeof editor.capitaliseSentences === "boolean"
          ? editor.capitaliseSentences
          : DEFAULT_EDITOR_SETTINGS.capitaliseSentences,
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
    transforms: validTransforms(raw.transforms),
    pdf: coercePdfSettings(raw.pdf),
    achievements,
    unseenAchievements: validUnseen(raw.unseenAchievements, achievements),
    disableAchievements: raw.disableAchievements === true,
  };
}

// -- The layered store ------------------------------------------------------
//
// Three sparse layers (global / namespace / device) stack into one resolved
// `Appearance`. See `./appearance-scopes.ts` for what each width means and why
// a shared login needs them. Everything below keeps the layers as the source
// of truth and re-derives `current` from them, so a write at one width can
// never smear across the others.

function readLayer(key: string): Layer {
  if (typeof localStorage === "undefined") return {};
  const raw = localStorage.getItem(key);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeLayer(key: string, layer: Layer): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (isEmptyLayer(layer)) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(layer));
  } catch {
    // Quota / private-mode failures leave the in-memory layer authoritative.
  }
}

/** localStorage key holding one namespace's cached layer. */
function namespaceLayerKey(slug: string): string {
  return `${NAMESPACE_STORAGE_PREFIX}${slug}`;
}

// Which namespace's layer is stacked right now. Seeded from the same
// per-device cursor the storage backend boots from, so first paint already
// wears the settings of the namespace that is about to open rather than
// flashing the default namespace's and swapping a tick later. The app keeps it
// in step through `setAppearanceNamespace`.
let activeSlug = getActiveNamespaceSlug();

function readGlobalLayer(): Layer {
  const stored = readLayer(STORAGE_KEY);
  if (!isEmptyLayer(stored)) return stored;
  // No appearance document yet — carry over the legacy bare-preset key if the
  // user had picked a theme under the old engine. It was an account-wide
  // choice, so it lands in the global layer.
  if (typeof localStorage === "undefined") return {};
  const legacy = localStorage.getItem(LEGACY_THEME_KEY);
  return legacy && THEME_SET.has(legacy) ? { theme: legacy } : {};
}

function readStoredLayers(): AppearanceLayers {
  return {
    global: readGlobalLayer(),
    namespace: readLayer(namespaceLayerKey(activeSlug)),
    device: readLayer(DEVICE_STORAGE_KEY),
  };
}

const listeners = new Set<() => void>();
let layers: AppearanceLayers = readStoredLayers();
let current: Appearance = resolve(layers);
// Ephemeral preview override. While the settings dialog is open it streams its
// unsaved draft here so the theme engine repaints live; the persisted layers
// are left untouched until Save commits them (or Cancel/close drops the
// preview). Only the projection onto `<html>` reads this — every other consumer
// keeps reading the persisted document, so editor/achievement behaviour doesn't
// shift mid-edit and reverts cleanly on Cancel.
let preview: Appearance | null = null;

function resolve(next: AppearanceLayers): Appearance {
  return coerce(
    resolveAppearanceLayers(DEFAULT_APPEARANCE as unknown as Layer, next),
  );
}

function emit() {
  for (const l of listeners) l();
}

// The appearance the theme projection should paint: the live preview when one
// is set, otherwise the resolved document.
function effective(): Appearance {
  return preview ?? current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Adopt a new layer stack: recompute the resolved appearance, mirror each
 * layer back to its localStorage home, and notify. The single write path —
 * every mutation below funnels through it.
 */
function persistLayers(next: AppearanceLayers): void {
  layers = next;
  current = resolve(next);
  writeLayer(STORAGE_KEY, next.global);
  writeLayer(namespaceLayerKey(activeSlug), next.namespace);
  writeLayer(DEVICE_STORAGE_KEY, next.device);
  emit();
}

/** Patch one leaf in whichever layer already owns it (global when none does). */
function persistLeaf(path: string, value: unknown): void {
  persistLayers(writeToOwningScope(layers, path, value));
}

/**
 * Point the namespace layer at another namespace. Called when the active
 * namespace changes, so the settings that namespace's users share come into
 * effect (and the previous one's stop applying) without a reload.
 */
export function setAppearanceNamespace(slug: string): void {
  if (slug === activeSlug) return;
  activeSlug = slug;
  persistLayers({ ...layers, namespace: readLayer(namespaceLayerKey(slug)) });
}

/** Which namespace's layer is currently stacked. */
export function getAppearanceNamespace(): string {
  return activeSlug;
}

/** Patch one top-level appearance field; the projecting effects apply it. */
export function updateAppearance<K extends keyof Appearance>(
  key: K,
  value: Appearance[K],
): void {
  persistLeaf(key, value);
}

/** The live appearance, read imperatively (e.g. to seed a backend file). */
export function getAppearance(): Appearance {
  return current;
}

/**
 * The appearance as it would resolve if every layer narrower than `scope` gave
 * up its opinion — what "Reset → Global settings" loads into the dialog's
 * draft. The unscoped keys come along unchanged, because they never had a
 * per-width value to fall back to.
 */
export function appearanceThroughScope(scope: SettingsScope): Appearance {
  return coerce(
    resolveThroughScope(DEFAULT_APPEARANCE as unknown as Layer, layers, scope),
  );
}

/** The whole layer stack, read imperatively (the settings dialog's Reset menu). */
export function getAppearanceLayers(): AppearanceLayers {
  return layers;
}

/** One layer, read imperatively — what the sync hook uploads for its scope. */
export function getAppearanceLayer(scope: SettingsScope): Layer {
  return layers[scope];
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
 * Commit an edited draft from the settings dialog at one width. `baseline` is
 * the appearance the dialog opened on, so only the settings the user actually
 * moved are written — see `applyScopedSave` for what that does to the narrower
 * layers. The unscoped keys (Transform rules, achievement progress) are not
 * part of the draft's scoped diff: the live values are kept, because the
 * dialog can't edit progress and the rules have a namespace of their own.
 */
export function commitAppearance(
  draft: Appearance,
  baseline: Appearance,
  scope: SettingsScope = "global",
): void {
  preview = null;
  const next = applyScopedSave(
    DEFAULT_APPEARANCE as unknown as Layer,
    layers,
    scope,
    draft as unknown as Layer,
    baseline as unknown as Layer,
  );
  // The Transform rules are authored content the dialog *can* edit, and they
  // stay unscoped — so they follow the draft, into the global layer where they
  // have always lived. Only when they actually moved, though: writing them on
  // every save would leave a global layer that is never empty, and the Reset
  // menu reads emptiness as "this width has nothing to fall back to".
  if (!jsonEqual(draft.transforms, baseline.transforms)) {
    next.global = setPath(next.global, "transforms", draft.transforms);
  }
  persistLayers(next);
}

/**
 * Replace one layer wholesale — the seam the backend settings stores write
 * through when another device's `settings.json` / `namespace-settings.json` is
 * adopted. Coerces defensively so a stale / partial remote file can't crash
 * the boot; a non-object reads as "no opinion" rather than throwing.
 */
export function replaceAppearanceLayer(
  scope: SettingsScope,
  raw: unknown,
): void {
  persistLayers({ ...layers, [scope]: isRecord(raw) ? raw : {} });
}

/**
 * Replace the **global** layer from a whole appearance document. The shape the
 * account-wide `settings.json` has always held, so this is the plain "adopt
 * that file" seam; narrower layers keep whatever they were overriding.
 */
export function replaceAppearance(raw: unknown): void {
  replaceAppearanceLayer("global", raw);
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
 *
 * Progress is unscoped: it is written to the global layer, so earned trophies
 * follow the user across devices the way they always have.
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
  let global = setPath(layers.global, "achievements", achievements);
  global = setPath(global, "unseenAchievements", unseen);
  persistLayers({ ...layers, global });
  return newly;
}

/** Clear the unseen-achievements queue (the trophy badge empties). */
export function clearUnseenAchievements(): void {
  if (current.unseenAchievements.length === 0) return;
  persistLayers({
    ...layers,
    global: setPath(layers.global, "unseenAchievements", []),
  });
}

/** Switch the achievements system on or off. */
export function setDisableAchievements(disabled: boolean): void {
  updateAppearance("disableAchievements", disabled);
}

/** Read the persisted appearance and re-render on change. */
export function useAppearance(): Appearance {
  // No server-snapshot argument: Preact's `useSyncExternalStore` takes only
  // (subscribe, getSnapshot). The app never renders on a server, so the
  // fallback was dead weight either way.
  return useSyncExternalStore(subscribe, () => current);
}

/**
 * Read the appearance the projection should paint — the live preview while the
 * settings dialog streams a draft, otherwise the persisted document.
 */
function useEffectiveAppearance(): Appearance {
  return useSyncExternalStore(subscribe, effective);
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
