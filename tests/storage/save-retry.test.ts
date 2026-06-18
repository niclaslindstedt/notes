import { describe, expect, it } from "vitest";

import {
  AuthError,
  ConflictError,
  RateLimitError,
} from "../../src/storage/adapter.ts";
import {
  backoffDelayMs,
  isRetryableSaveError,
} from "../../src/storage/save-retry.ts";

describe("save-retry", () => {
  it("grows the backoff cap per attempt and stays within [cap/2, cap)", () => {
    // Pin the jitter to its max so the result is the deterministic cap.
    const rand = () => 1;
    expect(backoffDelayMs(0, {}, rand)).toBe(500);
    expect(backoffDelayMs(1, {}, rand)).toBe(1000);
    expect(backoffDelayMs(2, {}, rand)).toBe(2000);
  });

  it("never returns below half the cap (equal jitter)", () => {
    const lo = backoffDelayMs(3, {}, () => 0);
    expect(lo).toBe(2000); // cap 4000, half = 2000
  });

  it("caps the curve at maxMs", () => {
    expect(backoffDelayMs(100, {}, () => 1)).toBe(30_000);
  });

  it("does not auto-retry the adapter's typed signals", () => {
    expect(isRetryableSaveError(new ConflictError({ text: "" }))).toBe(false);
    expect(isRetryableSaveError(new AuthError("nope"))).toBe(false);
    expect(isRetryableSaveError(new RateLimitError(1000))).toBe(false);
  });

  it("retries everything else (a momentary backend hiccup)", () => {
    expect(isRetryableSaveError(new Error("500"))).toBe(true);
    expect(isRetryableSaveError(new TypeError("network"))).toBe(true);
  });
});
