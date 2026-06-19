import { afterEach, describe, expect, it } from "vitest";

import {
  clearLogs,
  createLogger,
  formatLogs,
  getLogs,
  isDebugLogging,
  setDebugLogging,
} from "../../src/dev/logger.ts";

afterEach(() => {
  setDebugLogging(false);
  clearLogs();
});

describe("logger", () => {
  it("captures info/warn/error always, debug only when enabled", () => {
    const log = createLogger("test");
    log.debug("hidden");
    expect(getLogs()).toHaveLength(0);

    setDebugLogging(true);
    expect(isDebugLogging()).toBe(true);
    log.debug("shown");
    log.info("info");
    expect(getLogs().map((e) => e.message)).toEqual(["shown", "info"]);
  });

  it("returns a stable snapshot reference until the buffer changes", () => {
    const log = createLogger("test");
    log.info("a");
    const first = getLogs();
    // Same reference on a second read with no mutation — required so
    // useSyncExternalStore doesn't loop.
    expect(getLogs()).toBe(first);
    log.info("b");
    expect(getLogs()).not.toBe(first);
  });

  it("renders entries as copyable text and clears", () => {
    const log = createLogger("sync");
    log.warn("boom");
    expect(formatLogs()).toContain("[warn] sync: boom");
    clearLogs();
    expect(getLogs()).toHaveLength(0);
  });
});
