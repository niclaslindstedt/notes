// Pins the shared `dropboxError` helper both stores + the list walk now throw
// through. The subtle contract worth locking down: only the `rateLimit` opt
// turns a 429 into a RateLimitError; without it (read / list / delete) a 429
// stays a plain labelled failure — the per-call-site behaviour that predates
// the consolidation.

import { describe, expect, it } from "vitest";

import { RateLimitError } from "../../src/storage/adapter.ts";
import { dropboxError } from "../../src/storage/dropbox/errors.ts";

function res(status: number, body = "", headers?: Record<string, string>) {
  return new Response(body, { status, headers });
}

describe("dropboxError", () => {
  it("maps a 429 onto RateLimitError only when rateLimit is set", async () => {
    const err = await dropboxError("upload", res(429, "slow"), {
      rateLimit: true,
    });
    expect(err).toBeInstanceOf(RateLimitError);
  });

  it("carries the Retry-After delay (above the 5s floor) into the RateLimitError", async () => {
    const err = (await dropboxError(
      "upload",
      res(429, "", { "Retry-After": "8" }),
      {
        rateLimit: true,
      },
    )) as RateLimitError;
    expect(err).toBeInstanceOf(RateLimitError);
    // 8s header → 8000ms; a shorter header would clamp up to the 5000ms floor.
    expect(err.retryAfterMs).toBe(8000);
  });

  it("leaves a 429 as a generic labelled error when rateLimit is unset", async () => {
    const err = await dropboxError("download", res(429, "slow"));
    expect(err).not.toBeInstanceOf(RateLimitError);
    expect(err.message).toBe("Dropbox download failed: 429 slow");
  });

  it("builds a labelled generic error for any other non-ok status", async () => {
    expect((await dropboxError("delete", res(500, "boom"))).message).toBe(
      "Dropbox delete failed: 500 boom",
    );
    // Even an upload path: a non-429 failure is still the generic error.
    expect(
      (await dropboxError("upload", res(507, "full"), { rateLimit: true }))
        .message,
    ).toBe("Dropbox upload failed: 507 full");
  });
});
