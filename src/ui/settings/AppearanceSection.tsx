import { useEffect } from "react";

import { useT } from "../../i18n/index.ts";
import { loadAllFontFamilies } from "../../theme/fonts.ts";
import {
  COLOR_GROUPS,
  COLOR_LABELS,
  customThemeSeed,
  DARK_THEMES,
  DEFAULT_CUSTOM_THEME_COLORS_DARK,
  DENSITY_PRESETS,
  FAMILY_DEFAULT_THEME,
  FAMILY_LABELS,
  FONT_FAMILIES,
  FONT_SCALE_PRESETS,
  LIGHT_THEMES,
  PRESET_PALETTES,
  RADIUS_PRESETS,
  themeFamily,
  THEME_LABELS,
  type CustomTheme,
  type CustomThemeColors,
  type FontFamilyId,
  type ThemeFamily,
  type ThemePreset,
} from "../../theme/themes.ts";
import type { Appearance } from "../../theme/useTheme.ts";
import { Field, Section, SegmentedRow, ToggleRow } from "./shared.tsx";

type UpdateAppearance = <K extends keyof Appearance>(
  key: K,
  value: Appearance[K],
) => void;

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// The Appearance settings, ported from checklist's Appearance tab. Edits
// mutate the dialog's `draft`, which streams to the theme engine so it
// previews live as the user picks, but only persist on Save. checklist routes
// the font / text-size pickers through a custom SelectPicker; notes uses the
// lighter wrap-radio + segmented patterns to avoid pulling that subsystem
// over.
export function AppearanceSection({
  appearance,
  onUpdate,
}: {
  appearance: Appearance;
  onUpdate: UpdateAppearance;
}) {
  const t = useT();
  const isCustom = appearance.theme === "custom";

  // The non-default font families load on demand; pull them all in when the
  // settings open so the font picker's previews render in their real face
  // rather than the fallback stack.
  useEffect(() => {
    loadAllFontFamilies();
  }, []);

  function handleThemeChange(next: ThemePreset) {
    if (next === "custom" && appearance.theme !== "custom") {
      // Snapshot the theme that's currently on screen into the Custom
      // controls so the editor opens as a copy of what the user is looking
      // at and the first edit is a tweak, not a reset.
      const prefersLight =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-color-scheme: light)").matches;
      onUpdate("customTheme", customThemeSeed(appearance.theme, prefersLight));
    }
    onUpdate("theme", next);
  }

  function updateCustom<K extends keyof CustomTheme>(
    key: K,
    value: CustomTheme[K],
  ): void {
    onUpdate("customTheme", { ...appearance.customTheme, [key]: value });
  }

  function updateColor(key: keyof CustomThemeColors, value: string): void {
    onUpdate("customTheme", {
      ...appearance.customTheme,
      colors: { ...appearance.customTheme.colors, [key]: value },
    });
  }

  const family = themeFamily(appearance.theme);

  return (
    <>
      <Section title={t("settings.appearance.theme")}>
        <Field label={t("settings.appearance.mode")}>
          <ThemeModeRow
            value={appearance.theme}
            onChange={handleThemeChange}
            customColors={appearance.customTheme.colors}
          />
          {appearance.theme === "system" && (
            <p className="text-xs text-muted">
              {t("settings.appearance.systemNote")}
            </p>
          )}
        </Field>
        {(family === "dark" || family === "light") && (
          <Field label={t("settings.appearance.variant")}>
            <ThemeVariantRow
              value={appearance.theme}
              onChange={handleThemeChange}
            />
          </Field>
        )}
      </Section>

      <Section title={t("settings.appearance.font")}>
        <Field label={t("settings.appearance.fontFamily")}>
          <FontFamilyRow
            value={appearance.fontFamily}
            onChange={(v) => onUpdate("fontFamily", v)}
          />
        </Field>
        <Field label={t("settings.appearance.textSize")}>
          <SegmentedRow<number>
            ariaLabel={t("settings.appearance.textSize")}
            value={appearance.fontScale}
            options={FONT_SCALE_PRESETS.map((p) => ({
              value: p.scale,
              label: p.label,
            }))}
            onChange={(v) => onUpdate("fontScale", v)}
          />
        </Field>
      </Section>

      {isCustom && (
        <>
          <Section title={t("settings.appearance.colours")}>
            {COLOR_GROUPS.map((group) => (
              <Field key={group.id} label={group.label}>
                <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-x-2 gap-y-2.5">
                  {group.keys.map((k) => (
                    <ColorSwatchInput
                      key={k}
                      label={COLOR_LABELS[k]}
                      value={appearance.customTheme.colors[k]}
                      onChange={(c) => updateColor(k, c)}
                    />
                  ))}
                </div>
              </Field>
            ))}
          </Section>

          <Section title={t("settings.appearance.shapeMotion")}>
            <Field label={t("settings.appearance.cornerRadius")}>
              <SegmentedRow
                ariaLabel={t("settings.appearance.cornerRadius")}
                value={appearance.customTheme.radius}
                options={RADIUS_PRESETS.map((p) => ({
                  value: p,
                  label: capitalise(p),
                }))}
                onChange={(v) => updateCustom("radius", v)}
              />
            </Field>
            <Field label={t("settings.appearance.density")}>
              <SegmentedRow
                ariaLabel={t("settings.appearance.density")}
                value={appearance.customTheme.density}
                options={DENSITY_PRESETS.map((p) => ({
                  value: p,
                  label: capitalise(p),
                }))}
                onChange={(v) => updateCustom("density", v)}
              />
            </Field>
            <ToggleRow
              label={t("settings.appearance.reduceMotion")}
              hint={t("settings.appearance.reduceMotionHint")}
              checked={appearance.customTheme.reduceMotion}
              onChange={(v) => updateCustom("reduceMotion", v)}
            />
          </Section>
        </>
      )}
    </>
  );
}

// Per-preset display swatches for the theme picker buttons. `system`
// renders the dark+light combo as a diagonal split; `custom` reads the
// user's palette so the swatch tracks edits live.
function ThemeSwatches({
  theme,
  customColors,
}: {
  theme: ThemePreset;
  customColors?: CustomThemeColors;
}) {
  if (theme === "system") {
    return (
      <span
        aria-hidden
        className="inline-block h-4 w-4 shrink-0 rounded-sm border border-line"
        style={{
          background:
            "linear-gradient(135deg, #1d2027 0 50%, #eef0f2 50% 100%)",
        }}
      />
    );
  }
  const palette =
    theme === "custom"
      ? (customColors ?? DEFAULT_CUSTOM_THEME_COLORS_DARK)
      : PRESET_PALETTES[theme];
  const tones = [palette.pageBg, palette.surface, palette.fg, palette.accent];
  return (
    <span
      aria-hidden
      className="inline-flex h-4 gap-px overflow-hidden rounded-sm border border-line"
    >
      {tones.map((c, i) => (
        <span
          key={i}
          className="block h-full w-1.5"
          style={{ background: c }}
        />
      ))}
    </span>
  );
}

// Mode row — the broad family pick. Selecting the family the user is
// already in is a no-op (keeps the active variant); selecting a new family
// jumps to that family's default preset.
const MODE_ORDER: readonly ThemeFamily[] = [
  "dark",
  "light",
  "system",
  "custom",
];

function ThemeModeRow({
  value,
  onChange,
  customColors,
}: {
  value: ThemePreset;
  onChange: (next: ThemePreset) => void;
  customColors: CustomThemeColors;
}) {
  const activeFamily = themeFamily(value);
  return (
    <div role="radiogroup" className="flex flex-wrap gap-2">
      {MODE_ORDER.map((fam) => {
        const active = activeFamily === fam;
        const base =
          "flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-sm transition-opacity focus-visible:outline-none";
        const cls = active
          ? "border-accent bg-surface-2 text-fg-bright"
          : "border-line bg-transparent text-muted opacity-60 hover:border-accent hover:opacity-100";
        return (
          <button
            key={fam}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={FAMILY_LABELS[fam]}
            onClick={() => {
              if (active) return;
              onChange(FAMILY_DEFAULT_THEME[fam]);
            }}
            className={`${base} ${cls}`}
          >
            <ThemeSwatches
              theme={FAMILY_DEFAULT_THEME[fam]}
              customColors={customColors}
            />
            <span>{FAMILY_LABELS[fam]}</span>
          </button>
        );
      })}
    </div>
  );
}

// Variant row — appears only for the Dark / Light families. Lists every
// preset in that family with the same swatch + label pattern.
function ThemeVariantRow({
  value,
  onChange,
}: {
  value: ThemePreset;
  onChange: (next: ThemePreset) => void;
}) {
  const family = themeFamily(value);
  const variants =
    family === "dark" ? DARK_THEMES : family === "light" ? LIGHT_THEMES : null;
  if (!variants) return null;
  return (
    <div role="radiogroup" className="flex flex-wrap gap-2">
      {variants.map((theme) => {
        const active = value === theme;
        const base =
          "flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-sm transition-opacity focus-visible:outline-none";
        const cls = active
          ? "border-accent bg-surface-2 text-fg-bright"
          : "border-line bg-transparent text-muted opacity-60 hover:border-accent hover:opacity-100";
        return (
          <button
            key={theme}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={THEME_LABELS[theme]}
            onClick={() => onChange(theme)}
            className={`${base} ${cls}`}
          >
            <ThemeSwatches theme={theme} />
            <span>{THEME_LABELS[theme]}</span>
          </button>
        );
      })}
    </div>
  );
}

// Font-family picker as a wrap-friendly radio row, each option previewed in
// its own face. Avoids pulling checklist's SelectPicker / FloatingPanel.
function FontFamilyRow({
  value,
  onChange,
}: {
  value: FontFamilyId;
  onChange: (next: FontFamilyId) => void;
}) {
  return (
    <div role="radiogroup" className="flex flex-wrap gap-2">
      {FONT_FAMILIES.map((f) => {
        const active = value === f.id;
        const base =
          "cursor-pointer rounded border px-3 py-1.5 text-sm transition-opacity focus-visible:outline-none";
        const cls = active
          ? "border-accent bg-surface-2 text-fg-bright"
          : "border-line bg-transparent text-muted opacity-60 hover:border-accent hover:opacity-100";
        return (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(f.id)}
            className={`${base} ${cls}`}
            style={{ fontFamily: f.stack }}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

// Native colour input captioned beneath the swatch. Native is the right
// call: the colour controls want the OS hex entry, and the swatch itself
// doubles as the trigger.
function ColorSwatchInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <label className="flex cursor-pointer flex-col gap-1 text-xs text-muted">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-7 w-full cursor-pointer rounded border border-line bg-transparent p-0"
      />
      <span className="leading-tight">{label}</span>
    </label>
  );
}
