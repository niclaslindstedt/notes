import { useEffect, useId, useMemo, useRef, useState } from "react";

import { useT } from "../../i18n/index.ts";
import {
  clearLogs,
  getLogs,
  subscribeToLogs,
  type LogEntry,
  type LogLevel,
} from "../../dev/logger.ts";
import { Field, Section } from "./shared.tsx";

// The Logs settings tab, modelled on checklist's Logs tab: a live, filterable
// view of the in-app log ring buffer with Copy / Clear. It's how a sync problem
// — notably the phantom "changed on another device" conflict — is captured on a
// phone (where devtools are out of reach) and copied into a bug report. The
// capture toggle that persists the buffer across reloads lives on the Developer
// tab; turning it on is also what reveals this tab.
//
// Each entry is a card with a level-coloured left rail, its metadata on the
// first line (time · level · scope) and the message wrapped on its own line.

type LogFilter = "all" | LogLevel;

export function LogsSection() {
  const t = useT();
  const filterId = useId();
  // `version` is a tick that increments whenever the logger pushes or clears —
  // used to force a re-read of `getLogs()`. A ref-style subscription is simpler
  // than mirroring the whole buffer into state and lets the logger own storage.
  const [version, setVersion] = useState(0);
  const [filter, setFilter] = useState<LogFilter>("all");
  const [copyStatus, setCopyStatus] = useState<null | "copied" | "failed">(
    null,
  );
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
      setCopyStatus("copied");
    } catch {
      // Clipboard blocked (insecure context / permission) — surface it in the
      // status line; the user can still read the entries.
      setCopyStatus("failed");
    }
    setTimeout(() => setCopyStatus(null), 2000);
  }

  return (
    <Section title={t("settings.logs.title")}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Field label={t("settings.logs.filterLabel")}>
          <select
            id={filterId}
            value={filter}
            onChange={(e) => setFilter(e.target.value as LogFilter)}
            aria-label={t("settings.logs.filterLabel")}
            className="cursor-pointer rounded border border-line bg-surface-2 px-2.5 py-1 text-sm text-fg hover:border-accent focus:border-accent focus:outline-none"
          >
            <option value="all">{t("settings.logs.filterAll")}</option>
            <option value="info">{t("settings.logs.filterInfo")}</option>
            <option value="warn">{t("settings.logs.filterWarn")}</option>
            <option value="error">{t("settings.logs.filterError")}</option>
          </select>
        </Field>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            disabled={entries.length === 0}
            className="cursor-pointer rounded border border-line px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("settings.logs.copy")}
          </button>
          <button
            type="button"
            onClick={clearLogs}
            disabled={allEntries.length === 0}
            className="cursor-pointer rounded border border-line px-2.5 py-1 text-xs text-muted hover:border-danger hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("settings.logs.clear")}
          </button>
        </div>
      </div>

      <p className="text-xs text-muted">
        {entries.length === 0
          ? t("settings.logs.empty")
          : t("settings.logs.entryCount", { count: entries.length })}
        {copyStatus === "copied" && (
          <>
            {" — "}
            <span className="text-accent">{t("settings.logs.copied")}</span>
          </>
        )}
        {copyStatus === "failed" && (
          <>
            {" — "}
            <span className="text-danger">{t("settings.logs.copyFailed")}</span>
          </>
        )}
      </p>

      <div
        ref={listRef}
        onScroll={handleScroll}
        className="max-h-[334px] overflow-y-auto rounded border border-line bg-surface-2 font-mono text-xs"
      >
        {entries.length === 0 ? (
          <p className="px-2 py-3 text-muted">{t("settings.logs.empty")}</p>
        ) : (
          <ul className="flex flex-col">
            {entries.map((entry, idx) => (
              <li
                key={`${entry.ts}-${idx}`}
                className={`flex flex-col gap-0.5 border-b border-l-2 border-line px-2.5 py-1.5 last:border-b-0 ${railClass(
                  entry.level,
                )}`}
              >
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="text-muted tabular-nums">
                    {formatLogTime(entry.ts)}
                  </span>
                  <span className={levelClass(entry.level)}>
                    {entry.level.toUpperCase()}
                  </span>
                  <span className="text-accent">[{entry.scope}]</span>
                </span>
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

// The card's left rail colour, keyed by level so a wall of entries scans at a
// glance. Info — the common case — takes the accent so every row still carries
// a visible rail; warnings and errors stand out in their semantic colour.
function railClass(level: LogLevel): string {
  switch (level) {
    case "error":
      return "border-l-danger";
    case "warn":
      return "border-l-link";
    case "info":
      return "border-l-accent";
  }
}
