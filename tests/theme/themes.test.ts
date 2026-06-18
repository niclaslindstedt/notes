import { describe, expect, it } from "vitest";

import {
  COLOR_KEYS,
  customThemeSeed,
  DARK_THEMES,
  DEFAULT_CUSTOM_THEME_COLORS_DARK,
  DEFAULT_CUSTOM_THEME_COLORS_LIGHT,
  LIGHT_THEMES,
  PRESET_PALETTES,
  THEMES,
  THEME_LABELS,
  themeFamily,
  type ThemePreset,
} from "../../src/theme/themes.ts";

describe("themeFamily", () => {
  it("folds dark variants into the dark family", () => {
    for (const t of DARK_THEMES) expect(themeFamily(t)).toBe("dark");
  });

  it("folds light variants into the light family", () => {
    for (const t of LIGHT_THEMES) expect(themeFamily(t)).toBe("light");
  });

  it("treats system and custom as their own families", () => {
    expect(themeFamily("system")).toBe("system");
    expect(themeFamily("custom")).toBe("custom");
  });
});

describe("PRESET_PALETTES", () => {
  it("defines every colour slot for every concrete preset", () => {
    for (const [preset, palette] of Object.entries(PRESET_PALETTES)) {
      for (const key of COLOR_KEYS) {
        expect(palette[key], `${preset} is missing colour ${key}`).toMatch(
          /^#[0-9a-f]{6}$/i,
        );
      }
    }
  });
});

describe("THEME_LABELS", () => {
  it("labels every registered preset", () => {
    for (const t of THEMES) {
      expect(THEME_LABELS[t as ThemePreset]).toBeTruthy();
    }
  });
});

describe("customThemeSeed", () => {
  it("seeds Custom from the active preset's palette", () => {
    expect(customThemeSeed("dracula", false).colors).toEqual(
      PRESET_PALETTES.dracula,
    );
  });

  it("resolves system to the OS-preferred palette", () => {
    expect(customThemeSeed("system", true).colors).toEqual(
      DEFAULT_CUSTOM_THEME_COLORS_LIGHT,
    );
    expect(customThemeSeed("system", false).colors).toEqual(
      DEFAULT_CUSTOM_THEME_COLORS_DARK,
    );
  });

  it("falls back to the dark default when already custom", () => {
    expect(customThemeSeed("custom", false).colors).toEqual(
      DEFAULT_CUSTOM_THEME_COLORS_DARK,
    );
  });

  it("carries the shape/motion defaults", () => {
    const seed = customThemeSeed("dark", false);
    expect(seed.radius).toBe("md");
    expect(seed.density).toBe("comfortable");
    expect(seed.reduceMotion).toBe(false);
  });
});
