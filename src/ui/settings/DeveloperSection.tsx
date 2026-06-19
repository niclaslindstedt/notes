import { useDevMode } from "../../dev/useDevMode.ts";
import { useT } from "../../i18n/index.ts";
import { Section, ToggleRow } from "./shared.tsx";

// Developer-only controls, shown when developer mode is on. The capture-logs
// toggle persists the in-app logger to localStorage so the Logs tab survives a
// reload — and turning it on is what reveals the Logs tab itself. Ported from
// checklist's DeveloperTab, minus its fake-data toggle (notes has no dev-seed
// backend).
export function DeveloperSection() {
  const t = useT();
  const { captureLogs, setCaptureLogs } = useDevMode();
  return (
    <Section title={t("settings.developer.title")}>
      <p className="text-xs text-muted">{t("settings.developer.blurb")}</p>
      <ToggleRow
        label={t("settings.developer.captureLogs")}
        hint={t("settings.developer.captureLogsHint")}
        checked={captureLogs}
        onChange={setCaptureLogs}
      />
    </Section>
  );
}
