import { describe, expect, it } from "vitest";

import {
  LIVE_PULL_INTERVAL_MS,
  shouldLivePull,
} from "../../src/app/use-notes-sync.ts";

// The live-pull loop's timing policy, isolated from the interval. A pull may
// only land on a remote backend, once loaded, with nothing unsaved / no
// conflict / no save in flight, and only after the note has been quiet for the
// full window — so a remote edit can never overwrite a keystroke mid-edit.
const ok = {
  backendId: "dropbox" as const,
  loaded: true,
  dirty: false,
  hasConflict: false,
  inFlight: false,
  msSinceLastEdit: LIVE_PULL_INTERVAL_MS,
};

describe("shouldLivePull", () => {
  it("pulls on a remote backend after the quiet window with nothing pending", () => {
    expect(shouldLivePull(ok)).toBe(true);
  });

  it("never pulls on the local browser backend", () => {
    expect(shouldLivePull({ ...ok, backendId: "browser" })).toBe(false);
  });

  it("waits until the first load has settled", () => {
    expect(shouldLivePull({ ...ok, loaded: false })).toBe(false);
  });

  it("holds off while an edit is unsaved", () => {
    expect(shouldLivePull({ ...ok, dirty: true })).toBe(false);
  });

  it("holds off while a conflict is open", () => {
    expect(shouldLivePull({ ...ok, hasConflict: true })).toBe(false);
  });

  it("holds off while a save is in flight", () => {
    expect(shouldLivePull({ ...ok, inFlight: true })).toBe(false);
  });

  it("holds off until the note has been quiet for the full window", () => {
    expect(
      shouldLivePull({ ...ok, msSinceLastEdit: LIVE_PULL_INTERVAL_MS - 1 }),
    ).toBe(false);
  });

  it("honours a custom interval override", () => {
    expect(shouldLivePull({ ...ok, msSinceLastEdit: 50, intervalMs: 40 })).toBe(
      true,
    );
    expect(shouldLivePull({ ...ok, msSinceLastEdit: 30, intervalMs: 40 })).toBe(
      false,
    );
  });
});
