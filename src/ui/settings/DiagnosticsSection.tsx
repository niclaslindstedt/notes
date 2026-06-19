import { useState, useSyncExternalStore } from "react";

import {
  clearLogs,
  formatLogs,
  getLogs,
  isDebugLogging,
  setDebugLogging,
  subscribeToLogs,
  type LogEntry,
} from "../../dev/logger.ts";
import { useT } from "../../i18n/index.ts";
import { Button } from "../form/Button.tsx";
import { Section, ToggleRow } from "./shared.tsx";

// Diagnostics: a verbose-logging switch plus a viewer for the in-memory log
// ring buffer, so a sync problem (notably the phantom "changed on another
// device" conflict) can be captured on a phone — where devtools are out of
// reach — and copied into a bug report. The conflict-decision trace is always
// captured at warn level; the toggle adds the per-save debug trail.

const LEVEL_CLASS: Record<LogEntry["level"], string> = {
  debug: "text-muted",
  info: "text-fg",
  warn: "text-link",
  error: "text-danger",
};

export function DiagnosticsSection() {
  const t = useT();
  // Re-render on every captured entry and on the debug-flag toggle (both call
  // the logger's notify()), so the viewer and the switch stay live.
  const logs = useSyncExternalStore(subscribeToLogs, getLogs);
  const debug = useSyncExternalStore(subscribeToLogs, isDebugLogging);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(formatLogs());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure context / permission) — leave the label
      // unchanged; the user can still read the entries above.
    }
  }

  return (
    <Section title={t("settings.general.diagnosticsTitle")}>
      <ToggleRow
        label={t("settings.general.verboseLogging")}
        hint={t("settings.general.verboseLoggingHint")}
        checked={debug}
        onChange={setDebugLogging}
      />

      <p className="text-xs text-muted">{t("settings.general.logsHint")}</p>

      <div className="max-h-48 overflow-auto rounded border border-line bg-surface-2 p-2">
        {logs.length === 0 ? (
          <p className="text-xs text-muted">
            {t("settings.general.logsEmpty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5 font-mono text-[10px] leading-snug">
            {logs.map((e, i) => (
              <li key={i} className={LEVEL_CLASS[e.level]}>
                <span className="text-muted">{e.scope}</span> {e.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={copy} disabled={logs.length === 0}>
          {copied
            ? t("settings.general.logsCopied")
            : t("settings.general.copyLogs")}
        </Button>
        <Button onClick={clearLogs} disabled={logs.length === 0}>
          {t("settings.general.clearLogs")}
        </Button>
      </div>
    </Section>
  );
}
