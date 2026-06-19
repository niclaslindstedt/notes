import { unlock } from "../../achievements/index.ts";
import {
  SUPPORTED_LANGS,
  useLang,
  useT,
  writeLanguagePreference,
} from "../../i18n/index.ts";
import { useStandaloneMobile } from "../../pwa/standalone.ts";
import { setDisableAchievements, useAppearance } from "../../theme/useTheme.ts";
import { useNav } from "../nav-context.ts";
import { Field, Section, SegmentedRow, ToggleRow } from "./shared.tsx";

// Endonyms, never translated — each language names itself in its own tongue.
const LANG_LABEL: Record<string, string> = { en: "English", sv: "Svenska" };

// The landing settings tab. The language picker, a short note on where the app
// keeps its data, the achievements on/off switch, plus — only in the installed
// PWA on a phone / tablet — the toggle that hides the floating menu button in
// favour of an inward edge swipe. Appearance, editor, and storage live on
// their own tabs.
export function GeneralSection() {
  const t = useT();
  const lang = useLang();
  const standaloneMobile = useStandaloneMobile();
  const { showMenuButton, setShowMenuButton } = useNav();
  const { disableAchievements } = useAppearance();
  return (
    <Section title={t("settings.general.title")}>
      <Field label={t("settings.general.language")}>
        <SegmentedRow
          value={lang}
          ariaLabel={t("settings.general.language")}
          options={SUPPORTED_LANGS.map((l) => ({
            value: l,
            label: LANG_LABEL[l] ?? l,
          }))}
          onChange={(next) => {
            if (next === lang) return;
            writeLanguagePreference(next);
            unlock("polyglot");
          }}
        />
      </Field>
      <p className="text-xs text-muted">{t("settings.general.blurb")}</p>
      <ToggleRow
        label={t("settings.general.disableAchievements")}
        hint={t("settings.general.disableAchievementsHint")}
        checked={disableAchievements}
        onChange={setDisableAchievements}
      />
      {standaloneMobile && (
        <ToggleRow
          label={t("settings.general.menuButton")}
          hint={t("settings.general.menuButtonHint")}
          checked={showMenuButton}
          onChange={setShowMenuButton}
        />
      )}
    </Section>
  );
}
