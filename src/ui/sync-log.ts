import type { LogEntry } from "../dev/logger.ts";

// The data side of the sync-details modal's sync log: which logger scopes make
// up the cloud-sync story, how far back a copy reaches, and how a line reads
// once it leaves the app. Kept out of `SyncDetailsModal.tsx` because it is pure
// — no DOM, no React — so the parts that decide *what* gets copied are testable
// without rendering the modal.

// The logger scopes that make up the cloud-sync story. The Sync log section
// only surfaces these, so a reader sees the round-trip — auth, the per-note
// save, retries, the offline mirror, the encryption conversion — without the
// unrelated noise (seeding, tests) that also flows through the shared buffer.
export const SYNC_LOG_SCOPES: ReadonlySet<string> = new Set([
  "notes-sync",
  "dropbox",
  "gdrive",
  "nextcloud",
  "folder",
  "folder-handle",
  "cache",
  "oauth",
  "migration",
  "encrypt",
  "storage",
  "serialize",
  "migrate",
  "namespaces",
  "backend-pref",
]);

export type SyncLogRangeId = "last10m" | "last30m" | "last1h" | "everything";

export type SyncLogRange = {
  id: SyncLogRangeId;
  /** How far back the range reaches, or `null` for the whole buffer. */
  windowMs: number | null;
};

const MINUTE = 60_000;

// How far back a copy can reach. The narrow windows exist because the reason to
// copy the log is almost always "reproduce the problem, then hand the last few
// minutes to someone (or something) that can read it" — pasting the entire
// session buries those lines in unrelated history.
export const SYNC_LOG_RANGES: readonly SyncLogRange[] = [
  { id: "last10m", windowMs: 10 * MINUTE },
  { id: "last30m", windowMs: 30 * MINUTE },
  { id: "last1h", windowMs: 60 * MINUTE },
  { id: "everything", windowMs: null },
];

/** The subset of `entries` a range covers, in the order it was given. */
export function entriesInRange(
  entries: readonly LogEntry[],
  range: SyncLogRange,
  now: number,
): LogEntry[] {
  if (range.windowMs === null) return entries.slice();
  const cutoff = now - range.windowMs;
  return entries.filter((e) => e.ts >= cutoff);
}

export function formatLogTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function formatLogLine(entry: LogEntry): string {
  return `${formatLogTime(entry.ts)} [${entry.scope}] ${entry.level.toUpperCase()} ${entry.message}`;
}

/**
 * The clipboard payload for a range. Always chronological — a log is read
 * oldest-first once it's pasted into a bug report — whichever way the panel
 * happens to be listing it on screen.
 */
export function formatSyncLog(entries: readonly LogEntry[]): string {
  return entries
    .slice()
    .sort((a, b) => a.ts - b.ts)
    .map(formatLogLine)
    .join("\n");
}
