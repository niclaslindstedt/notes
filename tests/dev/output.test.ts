import { afterEach, describe, expect, it } from "vitest";

import { clearLogs, getLogs } from "../../src/dev/logger.ts";
import { error, header, info, status, warn } from "../../src/output.ts";

afterEach(() => {
  clearLogs();
});

describe("output", () => {
  it("writes each helper into the in-app log under the app scope", () => {
    status("Backend connected");
    info("3 notes");
    warn("token expiring");
    error("save failed");
    expect(
      getLogs().map(({ level, scope, message }) => [level, scope, message]),
    ).toEqual([
      ["info", "app", "Backend connected"],
      ["info", "app", "3 notes"],
      ["warn", "app", "token expiring"],
      ["error", "app", "save failed"],
    ]);
  });

  it("sets a header apart from the lines around it", () => {
    header("Sync");
    expect(getLogs()[0]).toMatchObject({
      level: "info",
      message: "── Sync ──",
    });
  });
});
