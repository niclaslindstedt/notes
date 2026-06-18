// Theme engine + appearance store. Holds the user's appearance preferences
// (theme preset, font family + size, and the Custom-theme overrides) in a
// `useSyncExternalStore` store persisted to localStorage, and projects them
// onto `<html>` so the CSS variables in `src/styles/` (and every Tailwind
// utility that resolves through them) follow the picker.
//
// Ported from checklist's `useTheme` + appearance store, adapted to notes:
// checklist edits a draft committed on Save, while notes applies every
// change live through this single store — the same immediate-apply shape
// the original three-way theme toggle had. The projection runs as four
// independent effects so a font change doesn't rewrite the colour overrides
// (and vice versa):
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

import { loadFontFamily } from "./fonts.ts";
import {
  COLOR_KEYS,
  COLOR_KEY_TO_CSS_VAR,
  DEFAULT_CUSTOM_THEME,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SCALE,
  DEFAULT_THEME,
  FONT_FAMILIES,
  FONT_SCALE_PRESETS,
  type CustomTheme,
  type DensityPreset,
  type FontFamilyId,
  type RadiusPreset,
  type ThemePreset,
} from "./themes.ts";

export type { CustomTheme, CustomThemeColors, ThemePreset } from "./themes.ts";

// The persisted appearance document. Plain JSON so it round-trips through
// localStorage unchanged.
export type Appearance = {
  theme: ThemePreset;
  fontFamily: FontFamilyId;
  // UI text-size multiplier; one of `FONT_SCALE_PRESETS`.
  fontScale: number;
  customTheme: CustomTheme;
};

export const DEFAULT_APPEARANCE: Appearance = {
  theme: DEFAULT_THEME,
  fontFamily: DEFAULT_FONT_FAMILY,
  fontScale: DEFAULT_FONT_SCALE,
  customTheme: DEFAULT_CUSTOM_THEME,
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

function emit() {
  for (const l of listeners) l();
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

/** Read the active appearance and re-render on change. */
export function useAppearance(): Appearance {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULT_APPEARANCE,
  );
}

/**
 * Read the active appearance and keep `<html>` in sync with it. Call once
 * near the root; the returned value re-renders consumers on change.
 */
export function useApplyAppearance(): Appearance {
  const appearance = useAppearance();
  const { theme, fontFamily, fontScale, customTheme } = appearance;

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

  return appearance;
}
