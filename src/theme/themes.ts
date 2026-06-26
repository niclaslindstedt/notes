// Theme data + the app-specific appearance settings that ride beside it.
//
// The shared theme vocabulary — the preset ids and families, the bundled font
// stacks and text-size steps, the radius / density shape presets, the
// Custom-theme shape, the per-preset palettes, and the seed / coerce helpers —
// now lives in `@niclaslindstedt/oss-framework/theme` (it used to be a local
// clone here). This module re-exports it so the app's import paths stay put,
// and keeps only what is genuinely app-side:
//
//   - notes' *reduced* colour vocabulary. The framework models eighteen colour
//     slots; notes paints eleven (`src/styles/palettes.css` + the `@theme
//     inline` map in `theme.css`), so the Custom editor renders only those
//     eleven. The framework projection still writes all eighteen `--*` vars on
//     `<html>` in custom mode, but the seven status / syntax slots notes has no
//     rule for (meta / path / flag / pipe / success / positive / negative) are
//     inert — the persisted `CustomTheme` carries them at their seeded
//     defaults and nothing reads them.
//   - the writing / list / sidebar preferences that live in the same synced
//     appearance store but have nothing to do with theming.
//
// CSS owns the actual palette rules for the non-custom presets (see
// `src/styles/palettes.css`); the framework's projection writes the custom
// slots inline on `<html>` (see `src/theme/useTheme.ts`).

import { type CopyScope, type DefaultTitleScheme } from "../domain/note.ts";
import type { CustomThemeColors } from "@niclaslindstedt/oss-framework/theme";

// --- Shared theme vocabulary, re-exported from the framework ----------------

export {
  // Preset vocabulary + families.
  THEMES,
  DEFAULT_THEME,
  DARK_THEMES,
  LIGHT_THEMES,
  themeFamily,
  FAMILY_DEFAULT_THEME,
  THEME_LABELS,
  FAMILY_LABELS,
  isThemePreset,
  // Fonts + text size.
  FONT_FAMILIES,
  DEFAULT_FONT_FAMILY,
  isFontFamily,
  FONT_SCALE_PRESETS,
  FONT_SCALES,
  MIN_FONT_SCALE,
  MAX_FONT_SCALE,
  DEFAULT_FONT_SCALE,
  isFontScale,
  // Shape presets.
  RADIUS_PRESETS,
  DENSITY_PRESETS,
  isRadiusPreset,
  isDensityPreset,
  // Palette data + the slot → CSS-var map the projection writes through.
  PRESET_PALETTES,
  DEFAULT_CUSTOM_THEME_COLORS_DARK,
  DEFAULT_CUSTOM_THEME_COLORS_LIGHT,
  COLOR_KEY_TO_CSS_VAR,
  // Custom theme shape + helpers.
  DEFAULT_CUSTOM_THEME,
  customThemeSeed,
  coerceCustomTheme,
} from "@niclaslindstedt/oss-framework/theme";

export type {
  ThemePreset,
  ThemeFamily,
  FontFamilyId,
  RadiusPreset,
  DensityPreset,
  CustomTheme,
  CustomThemeColors,
} from "@niclaslindstedt/oss-framework/theme";

// --- notes' reduced colour vocabulary (app-side) ----------------------------

// The eleven colour slots notes actually styles through. `as const satisfies`
// pins each entry to a real framework slot (so a typo or a slot the framework
// dropped fails to compile) while narrowing the element type to the literal
// union below — the source of truth for the Custom editor and the validator.
export const COLOR_KEYS = [
  "pageBg",
  "surface",
  "surface2",
  "surface3",
  "fg",
  "fgBright",
  "muted",
  "line",
  "accent",
  "danger",
  "link",
] as const satisfies readonly (keyof CustomThemeColors)[];

export type NotesColorKey = (typeof COLOR_KEYS)[number];

// Human-readable labels for the colour slots notes exposes, keyed by colour key.
export const COLOR_LABELS: Record<NotesColorKey, string> = {
  pageBg: "Page background",
  surface: "Surface",
  surface2: "Surface (raised)",
  surface3: "Surface (header)",
  fg: "Text",
  fgBright: "Bright text",
  muted: "Muted text",
  line: "Lines",
  accent: "Accent",
  danger: "Danger",
  link: "Link",
};

// How the Custom panel groups the colour controls so the section stays
// scannable. `label` heads each group. Notes' four groups cover only the
// eleven slots above — the framework's extra "status" group has no notes
// analogue.
export const COLOR_GROUPS: readonly {
  id: "backgrounds" | "text" | "lines" | "accents";
  label: string;
  keys: readonly NotesColorKey[];
}[] = [
  {
    id: "backgrounds",
    label: "Backgrounds",
    keys: ["pageBg", "surface", "surface2", "surface3"],
  },
  { id: "text", label: "Text", keys: ["fg", "fgBright", "muted"] },
  { id: "lines", label: "Lines", keys: ["line"] },
  { id: "accents", label: "Accents", keys: ["accent", "link", "danger"] },
];

// --- App-specific settings that ride beside the appearance (app-side) -------

// Editor preferences — how the note-writing surface lays out and whether it
// renders Markdown. These ride alongside the appearance settings (same store,
// same `settings.json` sync) because they're device/user writing preferences,
// not part of the note document.

// The horizontal margins around the writing column. `none` lets the text use
// the full width of the note area (the default — the editor should feel
// roomy); the others centre a progressively narrower column, trading width
// for breathing room at the page edges. `maxWidth` is the CSS cap applied to
// the column (`"none"` means uncapped / full-bleed).
export type EditorMargin = "none" | "sm" | "md" | "lg";

export const EDITOR_MARGINS: readonly {
  id: EditorMargin;
  label: string;
  maxWidth: string;
}[] = [
  { id: "none", label: "None", maxWidth: "none" },
  { id: "sm", label: "Small", maxWidth: "60rem" },
  { id: "md", label: "Medium", maxWidth: "44rem" },
  { id: "lg", label: "Large", maxWidth: "32rem" },
];

const EDITOR_MARGIN_IDS = new Set<string>(EDITOR_MARGINS.map((m) => m.id));

export function isEditorMargin(v: unknown): v is EditorMargin {
  return typeof v === "string" && EDITOR_MARGIN_IDS.has(v);
}

export function editorMarginMaxWidth(margin: EditorMargin): string {
  return EDITOR_MARGINS.find((m) => m.id === margin)?.maxWidth ?? "none";
}

// The persisted editor settings.
export type EditorSettings = {
  // Horizontal margins around the writing column.
  margin: EditorMargin;
  // Wrap long lines (`true`) versus keep them on one line and scroll the
  // editor horizontally (`false`).
  wordWrap: boolean;
  // Render Markdown inline as you type, Obsidian-style — every line but the
  // one the caret sits on shows formatted, the active line shows its source.
  renderMarkdown: boolean;
  // Stop the browser/OS checking spelling as you type — hides the red
  // squiggles. Handy for code, structured notes, or another language.
  disableSpellcheck: boolean;
  // Stop the browser/OS auto-correcting and auto-capitalising what you type
  // (mostly a mobile-keyboard behaviour) so your text goes through verbatim.
  disableAutocorrect: boolean;
  // Strip trailing spaces / tabs from every line each time a note is saved.
  // See `SaveFormatting` in the domain — applied to the stored bytes only.
  trimTrailingSpaces: boolean;
  // Ensure a saved note ends with a single trailing newline. See
  // `SaveFormatting` in the domain.
  trailingNewline: boolean;
  // Collect pasted/dropped image attachments in a block at the foot of the
  // note instead of rendering them inline where their reference sits. The
  // reference stays in the body; only where the thumbnail *renders* changes.
  imagesAtEnd: boolean;
  // Same as `imagesAtEnd`, for non-image file attachments (the file chips).
  filesAtEnd: boolean;
  // Shorten long bare URLs in the live preview to `domain` + this many
  // characters + `[...]` + the same many trailing characters, so a pasted
  // tracking link doesn't sprawl across the note. 0 shows the URL in full.
  // Only the displayed text is trimmed — the source and the click target keep
  // the whole URL. See `shortenUrl` in the domain.
  shortenLinkChars: number;
  // How a freshly created note is named before the user types a title of
  // their own. See `DefaultTitleScheme` in the domain.
  defaultTitle: DefaultTitleScheme;
  // What the editor's copy button writes to the clipboard — the body alone, the
  // title and body, or the whole `.md` file with its YAML frontmatter. See
  // `CopyScope` in the domain.
  copyScope: CopyScope;
};

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  margin: "none",
  wordWrap: true,
  renderMarkdown: true,
  disableSpellcheck: false,
  disableAutocorrect: false,
  trimTrailingSpaces: true,
  trailingNewline: true,
  imagesAtEnd: false,
  filesAtEnd: false,
  shortenLinkChars: 0,
  defaultTitle: "dateTime",
  copyScope: "body",
};

// The per-side character counts offered for link shortening. 0 is "Off" (show
// the whole URL); the rest keep that many characters either side of the elided
// middle. Drives the Editor settings control and bounds what the parser accepts.
export const LINK_SHORTEN_LENGTHS: readonly number[] = [0, 8, 12, 16, 24];

// How the overview lays each note out. `rows` is the compact list — title plus
// a one-line excerpt; `cards` is the taller, roomier treatment — title plus a
// multi-line excerpt that clamps its height and fades its tail out, so the list
// reads more like a wall of cards than a dense index; `list` is the densest of
// the three — a bare file-explorer listing of titles only, each note a single
// icon-and-name row with no excerpt, so the overview reads like a file tree. A
// device/user preference that rides alongside the appearance settings (it
// changes nothing about the note document), so it lives in the synced
// `Appearance`, not the note model.
export type ListLayout = "rows" | "cards" | "list";

export const LIST_LAYOUTS: readonly ListLayout[] = ["rows", "cards", "list"];

// Cards is the default — the overview should feel inviting out of the box, not
// like a terse file listing.
export const DEFAULT_LIST_LAYOUT: ListLayout = "cards";

export function isListLayout(v: unknown): v is ListLayout {
  return v === "rows" || v === "cards" || v === "list";
}

// Where the side menu places folders relative to the loose (ungrouped) notes
// above the action bar. `top` pins every folder above the loose notes (the
// historical layout); `mixed` drops folders into the same sorted run as the
// notes, so a folder sorts by the same key as a note — its name, or the
// timestamp of its most-recently-edited note. A side-menu layout preference,
// so it rides alongside the appearance settings.
export type FolderPlacement = "top" | "mixed";

export const FOLDER_PLACEMENTS: readonly FolderPlacement[] = ["top", "mixed"];

// Folders-on-top is the default — it matches the historical drawer layout.
export const DEFAULT_FOLDER_PLACEMENT: FolderPlacement = "top";

export function isFolderPlacement(v: unknown): v is FolderPlacement {
  return v === "top" || v === "mixed";
}

// The side-menu sort preference lives in `domain/note.ts` next to the pure
// sort helpers that consume it (and its sibling preference types `CopyScope` /
// `DefaultTitleScheme`); re-exported here so the appearance store and its
// settings UI keep importing it from the theme layer.
export {
  type NoteSortKey,
  NOTE_SORT_KEYS,
  DEFAULT_NOTE_SORT_KEY,
  isNoteSortKey,
} from "../domain/note.ts";
