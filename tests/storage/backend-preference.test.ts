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

  // notesd, the self-hosted daemon, was removed. A device that synced with it
  // opens on its own browser notes, as with sync off, and the pairing it held
  // — a device key among it — is not left sitting in storage.
  it("opens a device still set to notesd on this browser and forgets the pairing", () => {
    localStorage.setItem("notes:backend", "notesd");
    localStorage.setItem(
      "notes:notesd:config",
      JSON.stringify({
        endpoint: "https://10.0.0.2:7443",
        deviceKey: "k",
        spkiPin: "sha256:x",
        name: "desk",
      }),
    );
    expect(getBackend()).toBe("browser");
    expect(localStorage.getItem("notes:backend")).toBeNull();
    expect(localStorage.getItem("notes:notesd:config")).toBeNull();
  });
});
