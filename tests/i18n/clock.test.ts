import { describe, expect, it } from "vitest";

import { formatClockTime } from "../../src/i18n/clock.ts";
import { formatLogLine } from "../../src/ui/sync-log.ts";

// Local wall-clock moments, so the assertions hold in any time zone.
const morning = new Date(2026, 8, 28, 7, 26, 5).getTime();
const afternoon = new Date(2026, 8, 28, 16, 44, 0).getTime();

describe("formatClockTime", () => {
  it("keeps a 12-hour clock where the locale does (en-US)", () => {
    expect(formatClockTime(morning, { locale: "en-US" })).toBe("7:26 AM");
    expect(formatClockTime(afternoon, { locale: "en-US" })).toBe("4:44 PM");
    expect(formatClockTime(morning, { locale: "en-US", seconds: true })).toBe(
      "7:26:05 AM",
    );
  });

  it("keeps a 24-hour clock where the locale does", () => {
    for (const locale of ["sv-SE", "en-GB"]) {
      expect(formatClockTime(morning, { locale })).toBe("07:26");
      expect(formatClockTime(afternoon, { locale, seconds: true })).toBe(
        "16:44:00",
      );
    }
  });

  it("writes a plain space before AM/PM, so a copied line pastes as text", () => {
    expect(formatClockTime(morning, { locale: "en-US" })).not.toMatch(
      /[\u202f\u00a0]/,
    );
  });

  it("follows the device's locale when none is given", () => {
    const device = new Intl.DateTimeFormat().resolvedOptions().locale;
    expect(formatClockTime(morning, { seconds: true })).toBe(
      formatClockTime(morning, { seconds: true, locale: device }),
    );
  });
});

describe("formatLogLine", () => {
  it("stamps a log line with the device's clock", () => {
    const line = formatLogLine({
      ts: morning,
      level: "warn",
      scope: "dropbox",
      message: "token expiring",
    });
    expect(line).toBe(
      `${formatClockTime(morning, { seconds: true })} [dropbox] WARN token expiring`,
    );
  });
});
