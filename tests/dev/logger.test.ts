import { afterEach, describe, expect, it } from "vitest";

import {
  clearLogs,
  createLogger,
  getLogs,
  isCaptureEnabled,
  setCaptureEnabled,
} from "../../src/dev/logger.ts";

afterEach(() => {
  setCaptureEnabled(false);
  clearLogs();
});

describe("logger", () => {
  it("captures info/warn/error with scope and serialized payloads", () => {
    const log = createLogger("test");
    log.info("hello");
    log.warn("careful", { n: 1 });
    log.error("boom");
    const logs = getLogs();
    expect(logs.map((e) => e.level)).toEqual(["info", "warn", "error"]);
    expect(logs[0]).toMatchObject({ scope: "test", message: "hello" });
    expect(logs[1]!.message).toContain('"n":1');
  });

  it("time() brackets a call with start + ok entries and returns the value", async () => {
    const log = createLogger("t");
    const out = await log.time("load", async () => 42);
    expect(out).toBe(42);
    const msgs = getLogs().map((e) => e.message);
    expect(msgs[0]).toContain("load");
    expect(msgs[1]).toContain("load ok");
  });

  it("time() logs an error entry and rethrows on failure", async () => {
    const log = createLogger("t");
    await expect(
      log.time("x", async () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");
    const last = getLogs().at(-1)!;
    expect(last.level).toBe("error");
    expect(last.message).toContain("x failed");
  });

  it("toggles capture and clears the buffer", () => {
    setCaptureEnabled(true);
    expect(isCaptureEnabled()).toBe(true);
    createLogger("t").info("x");
    expect(getLogs()).toHaveLength(1);
    clearLogs();
    expect(getLogs()).toHaveLength(0);
  });
});
