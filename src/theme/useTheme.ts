// Minimal theme engine: projects the chosen preset onto `<html>` via a
// `data-theme` attribute that the CSS variables in `src/styles/theme.css`
// key off. This is the pared-down seed of checklist's richer engine
// (which adds per-editor palettes, a custom-theme editor, font families,
// density and radius controls) — bring those over with `copy-feature`
// when needed; the attribute-projection shape stays the same.

import { useEffect, useSyncExternalStore } from "react";

export type ThemePreset = "dark" | "light" | "system";

export const THEMES: readonly ThemePreset[] = ["dark", "light", "system"];
export const DEFAULT_THEME: ThemePreset = "dark";

const STORAGE_KEY = "notes/theme";

function isTheme(value: unknown): value is ThemePreset {
  return value === "dark" || value === "light" || value === "system";
}

function readStored(): ThemePreset {
  if (typeof localStorage === "undefined") return DEFAULT_THEME;
  const raw = localStorage.getItem(STORAGE_KEY);
  return isTheme(raw) ? raw : DEFAULT_THEME;
}

const listeners = new Set<() => void>();
let current: ThemePreset = readStored();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Persist + broadcast a new theme; the projecting effect applies it. */
export function setTheme(theme: ThemePreset): void {
  current = theme;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, theme);
  }
  emit();
}

/**
 * Read the active theme and keep `<html data-theme>` in sync with it. Call
 * once near the root; the returned value re-renders consumers on change.
 */
export function useTheme(): ThemePreset {
  const theme = useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULT_THEME,
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return theme;
}
