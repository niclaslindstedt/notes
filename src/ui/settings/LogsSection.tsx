import { useEffect, useMemo, useRef, useState } from "react";

import { useT } from "../../i18n/index.ts";
import {
  clearLogs,
  getLogs,
  subscribeToLogs,
  type LogEntry,
  type LogLevel,
} from "../../dev/logger.ts";
import { Button } from "../form/Button.tsx";
import { Field, Section, SegmentedRow } from "./shared.tsx";

// The Logs settings tab, ported from budget's LogsTab: a live, filterable view
// of the in-app log ring buffer with Copy / Clear. It's how a sync problem —
// notably the phantom "changed on another device" conflict — is captured on a
// phone (where devtools are out of reach) and copied into a bug report. The
// capture toggle that persists the buffer across reloads lives on the Developer
// tab; turning it on is also what reveals this tab.

type LogFilter = "all" | LogLevel;

export function LogsSection() {
  const t = useT();
  // `version` is a tick that increments whenever the logger pushes or clears —
  // used to force a re-read of `getLogs()`. A ref-style subscription is simpler
  // than mirroring the whole buffer into state and lets the logger own storage.
  const [version, setVersion] = useState(0);
  const [filter, setFilter] = useState<LogFilter>("all");
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Only auto-scroll new entries into view if the user was already pinned to
  // the bottom, so reading earlier entries while logs stream in stays sane.
  const stickToBottomRef = useRef(true);

  useEffect(() => subscribeToLogs(() => setVersion((v) => v + 1)), []);

  // `version` is the force-re-read signal — it bumps on every logger push /
  // clear so these recompute against the latest buffer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allEntries = useMemo(() => getLogs(), [version]);
  const entries = useMemo(
    () =>
      filter === "all"
        ? allEntries
        : allEntries.filter((e) => e.level === filter),
    [allEntries, filter],
  );

  // After every render where entries changed, snap to the bottom if the user
  // was already there.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 16;
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(
        entries.map(formatLogLine).join("\n"),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context / permission) — leave the label
      // unchanged; the user can still read the entries.
    }
  }

  return (
    <Section title={t("settings.logs.title")}>
      <Field label={t("settings.logs.filterLabel")}>
        <SegmentedRow<LogFilter>
          value={filter}
          onChange={setFilter}
          ariaLabel={t("settings.logs.filterLabel")}
          options={[
            { value: "all", label: t("settings.logs.filterAll") },
            { value: "info", label: t("settings.logs.filterInfo") },
            { value: "warn", label: t("settings.logs.filterWarn") },
            { value: "error", label: t("settings.logs.filterError") },
          ]}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          onClick={handleCopy}
          disabled={entries.length === 0}
        >
          {copied ? t("settings.logs.copied") : t("settings.logs.copy")}
        </Button>
        <Button onClick={clearLogs} disabled={allEntries.length === 0}>
          {t("settings.logs.clear")}
        </Button>
        <span className="text-xs text-muted">
          {entries.length === 0
            ? t("settings.logs.empty")
            : t("settings.logs.entryCount", { count: entries.length })}
        </span>
      </div>

      <div
        ref={listRef}
        onScroll={handleScroll}
        className="max-h-80 overflow-y-auto rounded border border-line bg-surface-2 font-mono text-[11px]"
      >
        {entries.length === 0 ? (
          <p className="px-2 py-3 text-muted">{t("settings.logs.empty")}</p>
        ) : (
          <ul className="flex flex-col">
            {entries.map((entry, idx) => (
              <li
                key={`${entry.ts}-${idx}`}
                className="flex flex-wrap items-baseline gap-2 border-b border-line px-2 py-1 last:border-b-0"
              >
                <span className="text-muted tabular-nums">
                  {formatLogTime(entry.ts)}
                </span>
                <span className={levelClass(entry.level)}>
                  {entry.level.toUpperCase()}
                </span>
                <span className="text-accent">[{entry.scope}]</span>
                <span className="break-words whitespace-pre-wrap text-fg">
                  {entry.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

function formatLogTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatLogLine(entry: LogEntry): string {
  return `${formatLogTime(entry.ts)} [${entry.scope}] ${entry.level.toUpperCase()} ${entry.message}`;
}

function levelClass(level: LogLevel): string {
  switch (level) {
    case "error":
      return "text-danger";
    case "warn":
      return "text-link";
    case "info":
      return "text-muted";
  }
}
