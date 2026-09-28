// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { getBackend } from "../../src/storage/backend-preference.ts";

afterEach(() => {
  localStorage.clear();
});

describe("getBackend", () => {
  it("reads each backend that still exists", () => {
    for (const id of ["folder", "dropbox", "icloud", "nextcloud"] as const) {
      localStorage.setItem("notes:backend", id);
      expect(getBackend()).toBe(id);
    }
  });

  it("falls back to this browser when nothing is stored", () => {
    expect(getBackend()).toBe("browser");
  });

  // A backend this build does not know — one since removed, or a value from a
  // newer build — opens on this browser's own notes, as with sync off.
  it("falls back to this browser for a backend it does not know", () => {
    localStorage.setItem("notes:backend", "retired-backend");
    expect(getBackend()).toBe("browser");
  });
});
