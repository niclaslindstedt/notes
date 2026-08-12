import { describe, expect, it } from "vitest";

import type { LogEntry } from "../../src/dev/logger.ts";
import {
  entriesInRange,
  formatSyncLog,
  SYNC_LOG_RANGES,
} from "../../src/ui/sync-log.ts";

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
const MINUTE = 60_000;

function entry(minutesAgo: number, message: string): LogEntry {
  return {
    ts: NOW - minutesAgo * MINUTE,
    level: "info",
    scope: "notes-sync",
    message,
  };
}

const ENTRIES: LogEntry[] = [
  entry(90, "ninety"),
  entry(45, "forty-five"),
  entry(20, "twenty"),
  entry(5, "five"),
];

function range(id: string) {
  const found = SYNC_LOG_RANGES.find((r) => r.id === id);
  if (!found) throw new Error(`no range ${id}`);
  return found;
}

describe("sync log ranges", () => {
  it("offers the four windows the copy menu lists, newest first", () => {
    expect(SYNC_LOG_RANGES.map((r) => r.id)).toEqual([
      "last10m",
      "last30m",
      "last1h",
      "everything",
    ]);
  });

  it("keeps only the entries inside the window", () => {
    const msgs = (id: string) =>
      entriesInRange(ENTRIES, range(id), NOW).map((e) => e.message);
    expect(msgs("last10m")).toEqual(["five"]);
    expect(msgs("last30m")).toEqual(["twenty", "five"]);
    expect(msgs("last1h")).toEqual(["forty-five", "twenty", "five"]);
  });

  it("takes the whole buffer for the everything range", () => {
    expect(entriesInRange(ENTRIES, range("everything"), NOW)).toHaveLength(4);
  });

  it("counts an entry exactly on the boundary as inside the window", () => {
    const onTheEdge = [entry(10, "edge")];
    expect(entriesInRange(onTheEdge, range("last10m"), NOW)).toHaveLength(1);
  });

  it("is empty when nothing happened inside the window", () => {
    expect(entriesInRange([entry(90, "old")], range("last30m"), NOW)).toEqual(
      [],
    );
  });

  it("writes the clipboard payload oldest-first whatever order it is given", () => {
    const text = formatSyncLog(ENTRIES.slice().reverse());
    const lines = text.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("ninety");
    expect(lines[3]).toContain("five");
    expect(lines[3]).toContain("[notes-sync] INFO");
  });
});
