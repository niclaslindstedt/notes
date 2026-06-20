// Theme data: the presets the engine can apply, the bundled font stacks,
// and the Custom-theme palettes / defaults. Ported from checklist's
// `src/theme/themes.ts` and pared to the notes slot vocabulary — notes
// styles through 11 colour slots (`--page-bg`, `--surface`, `--surface-2`,
// `--surface-3`, `--fg`, `--fg-bright`, `--muted`, `--line`, `--accent`,
// `--danger`, `--link`); checklist's seven extra status/syntax slots
// (meta / path / flag / pipe / success / positive / negative) have no
// notes analogue and are left out.
//
// CSS owns the actual palette rules for the non-custom presets (see
// `src/styles/palettes.css`); this module is the source of truth for which
// theme ids and font families are valid and supplies the palettes the
// Custom-theme editor seeds from. Read by the Appearance section,
// `useTheme`, and the appearance store's validator.

import { type CopyScope, type DefaultTitleScheme } from "../domain/note.ts";

// Theme preset. `dark` / `light` lock to the One Dark / One Light
// palettes; `dracula`, `monokai`, `githubDark`, `githubLight`,
// `solarizedLight`, and `quietLight` are the popular editor themes adapted
// to the slot vocabulary; `excel` mirrors Excel's light look; `system`
// follows `prefers-color-scheme`; `custom` applies the user's colour and
// shape overrides held under `Appearance.customTheme`. The runtime writes
// the active value to `data-theme` on `<html>`.
export type ThemePreset =
  | "dark"
  | "light"
  | "dracula"
  | "monokai"
  | "githubDark"
  | "githubLight"
  | "solarizedLight"
  | "quietLight"
  | "excel"
  | "system"
  | "custom";

// Allowed theme presets, in the order the Appearance picker shows them.
// Source of truth for the validator and the picker UI. Dark variants
// first, then light variants, then the two non-coloured presets.
export const THEMES = [
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
] as const;

// Dark is the default until the user picks otherwise.
export const DEFAULT_THEME: ThemePreset = "dark";

// Theme presets in the Dark family, in variant-row order (One Dark first).
// The Appearance picker derives the selected family from the active preset
// and renders the matching array as the variant row.
export const DARK_THEMES = [
  "dark",
  "dracula",
  "monokai",
  "githubDark",
] as const;

// Theme presets in the Light family — One Light first, then the light
// editor variants, then the Excel-flavoured light theme.
export const LIGHT_THEMES = [
  "light",
  "githubLight",
  "solarizedLight",
  "quietLight",
  "excel",
] as const;

// Broad colour-scheme family a preset belongs to. The picker's mode row
// selects the family (Dark / Light / System / Custom); a variant row
// appears underneath for the Dark / Light families.
export type ThemeFamily = "dark" | "light" | "system" | "custom";

// Resolve a preset to its broad family. Dark / Light variants fold into
// their bucket; `system` and `custom` are their own families.
export function themeFamily(preset: ThemePreset): ThemeFamily {
  if ((DARK_THEMES as readonly string[]).includes(preset)) return "dark";
  if ((LIGHT_THEMES as readonly string[]).includes(preset)) return "light";
  return preset as "system" | "custom";
}

// Default preset for each family — what the mode row jumps to when the
// user picks a family they weren't already in.
export const FAMILY_DEFAULT_THEME: Record<ThemeFamily, ThemePreset> = {
  dark: "dark",
  light: "light",
  system: "system",
  custom: "custom",
};

// Bundled webfont families the body reads through `--app-font-family`.
// Monospace is the default — the UI is deliberately reminiscent of a
// plain-text editor. The other three load on demand (see
// `src/theme/fonts.ts`). `stack` is the full CSS `font-family` value.
export type FontFamilyId = "mono" | "sans" | "serif" | "dyslexic";

export const FONT_FAMILIES: readonly {
  id: FontFamilyId;
  label: string;
  stack: string;
}[] = [
  {
    id: "mono",
    label: "Monospace",
    stack:
      '"JetBrains Mono", "Fira Code", ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  },
  {
    id: "sans",
    label: "Sans-serif",
    stack:
      '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  {
    id: "serif",
    label: "Serif",
    stack: '"Source Serif 4", ui-serif, Georgia, "Times New Roman", serif',
  },
  {
    id: "dyslexic",
    label: "OpenDyslexic",
    stack:
      '"OpenDyslexic", "Comic Sans MS", ui-sans-serif, system-ui, sans-serif',
  },
];

export const DEFAULT_FONT_FAMILY: FontFamilyId = "mono";

// Discrete UI text-size multipliers offered by the Appearance section. The
// body's `font-size` multiplies by `--app-font-scale`, so every rem
// dimension downstream picks up the chosen step.
export const FONT_SCALE_PRESETS: readonly {
  scale: number;
  label: string;
}[] = [
  { scale: 0.9, label: "90%" },
  { scale: 1, label: "100%" },
  { scale: 1.1, label: "110%" },
  { scale: 1.25, label: "125%" },
];

export const MIN_FONT_SCALE = 0.9;
export const MAX_FONT_SCALE = 1.25;
export const DEFAULT_FONT_SCALE = 1;

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

export type RadiusPreset = "none" | "sm" | "md" | "lg";
export type DensityPreset = "compact" | "comfortable" | "spacious";

export const RADIUS_PRESETS: readonly RadiusPreset[] = [
  "none",
  "sm",
  "md",
  "lg",
];
export const DENSITY_PRESETS: readonly DensityPreset[] = [
  "compact",
  "comfortable",
  "spacious",
];

// Per-slot custom colours — one field per CSS variable the chrome reads.
// The runtime maps each key to its `--<slug>` CSS var on `<html>` when the
// active theme is `custom`.
export type CustomThemeColors = {
  pageBg: string;
  surface: string;
  surface2: string;
  surface3: string;
  fg: string;
  fgBright: string;
  muted: string;
  line: string;
  accent: string;
  danger: string;
  link: string;
};

// User-authored theme applied when `Appearance.theme === "custom"`. The
// picker re-seeds it from whichever theme is on screen each time the user
// switches into Custom, so the editor opens as a copy of the current look
// and the first edit is a tweak.
export type CustomTheme = {
  colors: CustomThemeColors;
  radius: RadiusPreset;
  density: DensityPreset;
  // Globally short-circuits transition / animation durations via a
  // high-specificity rule keyed off `[data-reduce-motion="true"]`.
  reduceMotion: boolean;
};

// Per-preset palette lookup — the single source of truth for the Custom
// editor's seed colours and the picker's variant-row swatches. Each entry
// is checked against `CustomThemeColors`, so adding a preset is one entry
// here (plus registering its id in `ThemePreset` / `THEMES` and the
// matching family array). Colours mirror the rules in `palettes.css`.
//
// All presets mirror checklist's palettes exactly (reduced to notes' slots),
// so the Custom-theme seed and the picker swatches match what the CSS
// palettes paint.
export const PRESET_PALETTES: Record<
  Exclude<ThemePreset, "system" | "custom">,
  CustomThemeColors
> = {
  // One Dark — notes' shell default.
  dark: {
    pageBg: "#1d2027",
    surface: "#282c34",
    surface2: "#2c313a",
    surface3: "#21252b",
    fg: "#abb2bf",
    fgBright: "#e6e6e6",
    muted: "#9097a8",
    line: "#3e4451",
    accent: "#98c379",
    danger: "#e06c75",
    link: "#61afef",
  },
  // One Light.
  light: {
    pageBg: "#eef0f2",
    surface: "#f8f9fa",
    surface2: "#f1f3f5",
    surface3: "#e4e7eb",
    fg: "#2f323a",
    fgBright: "#15171c",
    muted: "#6a6f7c",
    line: "#ccd0d6",
    accent: "#3f8c3e",
    danger: "#c9434c",
    link: "#2960c2",
  },
  dracula: {
    pageBg: "#21222c",
    surface: "#282a36",
    surface2: "#343746",
    surface3: "#191a21",
    fg: "#f8f8f2",
    fgBright: "#ffffff",
    muted: "#8b93c2",
    line: "#44475a",
    accent: "#50fa7b",
    danger: "#ff5555",
    link: "#8be9fd",
  },
  monokai: {
    pageBg: "#1e1f1c",
    surface: "#272822",
    surface2: "#3e3d32",
    surface3: "#1b1c18",
    fg: "#f8f8f2",
    fgBright: "#ffffff",
    muted: "#9c9882",
    line: "#49483e",
    accent: "#a6e22e",
    danger: "#f92672",
    link: "#66d9ef",
  },
  githubDark: {
    pageBg: "#010409",
    surface: "#0d1117",
    surface2: "#161b22",
    surface3: "#010409",
    fg: "#c9d1d9",
    fgBright: "#f0f6fc",
    muted: "#8b949e",
    line: "#30363d",
    accent: "#7ee787",
    danger: "#ff7b72",
    link: "#79c0ff",
  },
  githubLight: {
    pageBg: "#f6f8fa",
    surface: "#ffffff",
    surface2: "#eaeef2",
    surface3: "#d0d7de",
    fg: "#1f2328",
    fgBright: "#0d1117",
    muted: "#6e7781",
    line: "#d0d7de",
    accent: "#1a7f37",
    danger: "#cf222e",
    link: "#0969da",
  },
  solarizedLight: {
    pageBg: "#eee8d5",
    surface: "#fdf6e3",
    surface2: "#f5efdc",
    surface3: "#e3ddc9",
    fg: "#586e75",
    fgBright: "#073642",
    muted: "#657b83",
    line: "#d6cfb8",
    accent: "#859900",
    danger: "#dc322f",
    link: "#268bd2",
  },
  quietLight: {
    pageBg: "#f5f5f5",
    surface: "#ffffff",
    surface2: "#ebebeb",
    surface3: "#e0e0e0",
    fg: "#333333",
    fgBright: "#1a1a1a",
    muted: "#767676",
    line: "#d4d4d4",
    accent: "#4f894c",
    danger: "#b73525",
    link: "#4b83cd",
  },
  excel: {
    pageBg: "#e6e6e6",
    surface: "#ffffff",
    surface2: "#f3f2f1",
    surface3: "#e1dfdd",
    fg: "#252423",
    fgBright: "#171717",
    muted: "#605e5c",
    line: "#d4d4d4",
    accent: "#217346",
    danger: "#c00000",
    link: "#0563c1",
  },
};

// One Dark is the Custom theme's pristine default and the validator's
// fallback for a missing colour; One Light is the light-mode seed. Both are
// referenced by name elsewhere, so they keep a named alias derived from the
// table above.
export const DEFAULT_CUSTOM_THEME_COLORS_DARK = PRESET_PALETTES.dark;
export const DEFAULT_CUSTOM_THEME_COLORS_LIGHT = PRESET_PALETTES.light;

export const DEFAULT_CUSTOM_THEME: CustomTheme = {
  colors: DEFAULT_CUSTOM_THEME_COLORS_DARK,
  radius: "md",
  density: "comfortable",
  reduceMotion: false,
};

// Snapshot of the theme currently on screen, used to seed the Custom
// controls when the user switches into Custom so the editor opens as a copy
// of the current look. Colours come from the active preset; `system`
// resolves via the caller-supplied `prefersLight`.
export function customThemeSeed(
  theme: ThemePreset,
  prefersLight: boolean,
): CustomTheme {
  const colors =
    theme === "system"
      ? prefersLight
        ? DEFAULT_CUSTOM_THEME_COLORS_LIGHT
        : DEFAULT_CUSTOM_THEME_COLORS_DARK
      : theme === "custom"
        ? DEFAULT_CUSTOM_THEME_COLORS_DARK
        : PRESET_PALETTES[theme];
  return {
    colors,
    radius: DEFAULT_CUSTOM_THEME.radius,
    density: DEFAULT_CUSTOM_THEME.density,
    reduceMotion: DEFAULT_CUSTOM_THEME.reduceMotion,
  };
}

// Ordered list of colour keys. The validator walks every slot; the picker
// uses it via `COLOR_GROUPS` for display order within a group.
export const COLOR_KEYS: readonly (keyof CustomThemeColors)[] = [
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
];

// Maps each colour key to the CSS-variable slug (the part after `--`) the
// runtime writes when Custom is active.
export const COLOR_KEY_TO_CSS_VAR: Record<keyof CustomThemeColors, string> = {
  pageBg: "page-bg",
  surface: "surface",
  surface2: "surface-2",
  surface3: "surface-3",
  fg: "fg",
  fgBright: "fg-bright",
  muted: "muted",
  line: "line",
  accent: "accent",
  danger: "danger",
  link: "link",
};

// Human-readable labels for the colour slots, keyed by colour key.
export const COLOR_LABELS: Record<keyof CustomThemeColors, string> = {
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
// scannable. `label` heads each group.
export const COLOR_GROUPS: readonly {
  id: "backgrounds" | "text" | "lines" | "accents";
  label: string;
  keys: readonly (keyof CustomThemeColors)[];
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

// Display labels for the theme presets and families, used by the picker.
export const THEME_LABELS: Record<ThemePreset, string> = {
  dark: "One Dark",
  light: "One Light",
  dracula: "Dracula",
  monokai: "Monokai",
  githubDark: "GitHub Dark",
  githubLight: "GitHub Light",
  solarizedLight: "Solarized Light",
  quietLight: "Quiet Light",
  excel: "Excel",
  system: "System",
  custom: "Custom",
};

export const FAMILY_LABELS: Record<ThemeFamily, string> = {
  dark: "Dark",
  light: "Light",
  system: "System",
  custom: "Custom",
};
