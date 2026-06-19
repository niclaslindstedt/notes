import { unlock } from "../../achievements/index.ts";
import { useLang, useT, writeLanguagePreference } from "../../i18n/index.ts";
import { useStandaloneMobile } from "../../pwa/standalone.ts";
import { setDisableAchievements, useAppearance } from "../../theme/useTheme.ts";
import { useNav } from "../nav-context.ts";
import { DiagnosticsSection } from "./DiagnosticsSection.tsx";
import { LanguagePicker } from "./LanguagePicker.tsx";
import { Field, Section, ToggleRow } from "./shared.tsx";

// The landing settings tab, split into focused bordered sections (mirroring
// budget's General tab): a flag-based language picker, a short note on where
// the app keeps its data, the achievements on/off switch, plus — only in the
// installed PWA on a phone / tablet — the toggle that hides the floating menu
// button in favour of an inward edge swipe. Appearance, editor, and storage
// live on their own tabs.
export function GeneralSection() {
  const t = useT();
  const lang = useLang();
  const standaloneMobile = useStandaloneMobile();
  const { showMenuButton, setShowMenuButton } = useNav();
  const { disableAchievements } = useAppearance();
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
          onChange={setDisableAchievements}
        />
      </Section>

      {standaloneMobile && (
        <Section title={t("settings.general.menuTitle")}>
          <ToggleRow
            label={t("settings.general.menuButton")}
            hint={t("settings.general.menuButtonHint")}
            checked={showMenuButton}
            onChange={setShowMenuButton}
          />
        </Section>
      )}

      <DiagnosticsSection />
    </>
  );
}
