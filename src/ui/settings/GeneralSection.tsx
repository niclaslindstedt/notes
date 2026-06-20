import { unlock } from "../../achievements/index.ts";
import { useDevMode } from "../../dev/useDevMode.ts";
import { useLang, useT, writeLanguagePreference } from "../../i18n/index.ts";
import { useStandaloneMobile } from "../../pwa/standalone.ts";
import type { Appearance } from "../../theme/useTheme.ts";
import { useNav } from "../nav-context.ts";
import { LanguagePicker } from "./LanguagePicker.tsx";
import { Field, Section, SegmentedRow, ToggleRow } from "./shared.tsx";

type UpdateAppearance = <K extends keyof Appearance>(
  key: K,
  value: Appearance[K],
) => void;

// The landing settings tab, split into focused bordered sections (mirroring
// budget's General tab): a flag-based language picker, a short note on where
// the app keeps its data, the achievements on/off switch, the developer-mode
// switch that reveals the Developer tab, plus — only in the installed PWA on a
// phone / tablet — a segmented control choosing how the side menu is opened:
// the floating button, or an inward edge swipe in its place. Appearance,
// editor, and storage live on their own tabs.
//
// The achievements switch is part of the persisted appearance document, so it
// edits the dialog's `draft` and only takes effect on Save. The language,
// menu-activation, and developer-mode controls live in their own device-local
// stores and apply immediately.
export function GeneralSection({
  appearance,
  onUpdate,
}: {
  appearance: Appearance;
  onUpdate: UpdateAppearance;
}) {
  const t = useT();
  const lang = useLang();
  const standaloneMobile = useStandaloneMobile();
  const { showMenuButton, setShowMenuButton } = useNav();
  const { disableAchievements } = appearance;
  const { devMode, setDevMode } = useDevMode();
  return (
    <>
      <Section title={t("settings.general.languageTitle")}>
        <Field label={t("settings.general.languageChoose")}>
          <LanguagePicker
            value={lang}
            onChange={(next) => {
              if (next === lang) return;
              writeLanguagePreference(next);
              unlock("polyglot");
            }}
          />
        </Field>
        <p className="text-xs text-muted">
          {t("settings.general.languageHint")}
        </p>
      </Section>

      <Section title={t("settings.general.achievementsTitle")}>
        <ToggleRow
          label={t("settings.general.disableAchievements")}
          hint={t("settings.general.disableAchievementsHint")}
          checked={disableAchievements}
          onChange={(v) => onUpdate("disableAchievements", v)}
        />
      </Section>

      {standaloneMobile && (
        <Section title={t("settings.general.menuTitle")}>
          <Field label={t("settings.general.menuActivation")}>
            <SegmentedRow<"swipe" | "button">
              ariaLabel={t("settings.general.menuActivation")}
              value={showMenuButton ? "button" : "swipe"}
              options={[
                {
                  value: "swipe",
                  label: t("settings.general.menuActivationSwipe"),
                },
                {
                  value: "button",
                  label: t("settings.general.menuActivationButton"),
                },
              ]}
              onChange={(next) => setShowMenuButton(next === "button")}
            />
            <p className="text-xs text-muted">
              {t("settings.general.menuActivationHint")}
            </p>
          </Field>
        </Section>
      )}

      <Section title={t("settings.general.developerTitle")}>
        <ToggleRow
          label={t("settings.general.devMode")}
          hint={t("settings.general.devModeHint")}
          checked={devMode}
          onChange={setDevMode}
        />
      </Section>
    </>
  );
}
