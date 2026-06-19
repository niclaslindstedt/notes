// Minimal design tokens for the native UI. The web app has a full theme
// engine (presets, custom overrides, fonts) under ../../src/theme; that is
// DOM/CSS-variable based and not portable, so the native app starts with a
// small light/dark token set keyed off the OS colour scheme. The values
// mirror the web app's default One Dark / One Light palettes
// (../../src/styles/palettes.css) so the two surfaces feel like one product.
// Richer theming can grow here later without touching the shared core.

import { useColorScheme } from "react-native";

export interface Tokens {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textBright: string;
  textMuted: string;
  accent: string;
  accentText: string;
  danger: string;
  link: string;
}

// One Dark — the web app's default (and pre-boot) palette.
const dark: Tokens = {
  bg: "#1d2027",
  surface: "#282c34",
  surfaceAlt: "#2c313a",
  border: "#3e4451",
  text: "#abb2bf",
  textBright: "#e6e6e6",
  textMuted: "#9097a8",
  accent: "#98c379",
  accentText: "#1d2027",
  danger: "#e06c75",
  link: "#61afef",
};

// One Light — the web app's light palette.
const light: Tokens = {
  bg: "#eef0f2",
  surface: "#f8f9fa",
  surfaceAlt: "#f1f3f5",
  border: "#ccd0d6",
  text: "#2f323a",
  textBright: "#15171c",
  textMuted: "#6a6f7c",
  accent: "#3f8c3e",
  accentText: "#eef0f2",
  danger: "#c9434c",
  link: "#1d6fd0",
};

export function useTokens(): Tokens {
  return useColorScheme() === "light" ? light : dark;
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

// The web app keys everything off a single `--radius` (8px); keep one base
// radius here and a pill for badges rather than checklist's sm/md/lg triple.
export const radius = {
  md: 8,
  lg: 16,
  pill: 999,
} as const;
