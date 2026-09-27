import { afterEach, describe, expect, it, vi } from "vitest";

import { drain, resetBus, unlock } from "../../src/achievements/bus.ts";

afterEach(() => {
  resetBus();
  vi.unstubAllGlobals();
});

describe("achievements unlock bus", () => {
  it("queues an unlock for the watcher to drain", () => {
    unlock("firstNote");
    expect(drain()).toEqual(["firstNote"]);
    expect(drain()).toEqual([]);
  });

  it("drops every unlock in the phone and desktop build", () => {
    // `__EMBEDDED__` is a compile-time define in a real build; no Nird native
    // build carries achievements, so nothing is ever queued there.
    vi.stubGlobal("__EMBEDDED__", true);
    unlock("firstNote");
    expect(drain()).toEqual([]);
  });
});
