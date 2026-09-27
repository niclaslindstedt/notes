// The phone wrapper's two decisions about the page (`native/src/shell.ts`) and
// the loopback origin it serves the page from (`native/src/local-server.ts`).
//
// None of this runs without a phone, and every failure is quiet: a navigation
// guard that admits too much leaves a provider's page stranded in the WebView,
// one that admits too little sends the app's own pages to Safari, and a port
// that moves hands the page a new origin — an empty `localStorage` and every
// note apparently gone. So they are pinned here.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SERVICE_WORKER_TEARDOWN, staysInApp } from "../../native/src/shell.ts";

const ORIGIN = "http://localhost:8311";

describe("staysInApp", () => {
  it("keeps the app's own origin in the WebView", () => {
    expect(staysInApp(ORIGIN, ORIGIN)).toBe(true);
    expect(staysInApp(`${ORIGIN}/`, ORIGIN)).toBe(true);
    expect(staysInApp(`${ORIGIN}/#/n/default/abc`, ORIGIN)).toBe(true);
    expect(staysInApp(`${ORIGIN}/privacy/`, ORIGIN)).toBe(true);
    expect(staysInApp(`${ORIGIN}?x=1`, ORIGIN)).toBe(true);
    expect(staysInApp("about:blank", ORIGIN)).toBe(true);
  });

  it("sends everything else to the system browser", () => {
    expect(staysInApp("https://apps.agilator.se/notes/privacy/", ORIGIN)).toBe(
      false,
    );
    expect(staysInApp("https://www.dropbox.com/oauth2/authorize", ORIGIN)).toBe(
      false,
    );
    expect(staysInApp("mailto:hello@agilator.se", ORIGIN)).toBe(false);
    // Another wrapper's port, and a longer port with ours as its prefix.
    expect(staysInApp("http://localhost:8301/", ORIGIN)).toBe(false);
    expect(staysInApp("http://localhost:83110/", ORIGIN)).toBe(false);
    expect(staysInApp("http://127.0.0.1:8311/", ORIGIN)).toBe(false);
    expect(staysInApp(`${ORIGIN}.evil.example/`, ORIGIN)).toBe(false);
  });
});

describe("SERVICE_WORKER_TEARDOWN", () => {
  it("unregisters every worker and empties every cache", async () => {
    const unregistered: string[] = [];
    const deleted: string[] = [];
    const navigator = {
      serviceWorker: {
        getRegistrations: () =>
          Promise.resolve(
            ["a", "b"].map((id) => ({
              unregister: () => unregistered.push(id),
            })),
          ),
      },
    };
    const caches = {
      keys: () => Promise.resolve(["precache", "runtime"]),
      delete: (key: string) => deleted.push(key),
    };
    const window = { caches };
    new Function("navigator", "caches", "window", SERVICE_WORKER_TEARDOWN)(
      navigator,
      caches,
      window,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    // `injectJavaScript` wants the script to end on a value.
    expect(SERVICE_WORKER_TEARDOWN.trimEnd().endsWith("true;")).toBe(true);
    expect(unregistered).toEqual(["a", "b"]);
    expect(deleted).toEqual(["precache", "runtime"]);
  });

  it("is harmless where there is no service worker or cache", () => {
    expect(() =>
      new Function("navigator", "caches", "window", SERVICE_WORKER_TEARDOWN)(
        {},
        undefined,
        {},
      ),
    ).not.toThrow();
  });
});

describe("the loopback origin", () => {
  const source = readFileSync(
    new URL("../../native/src/local-server.ts", import.meta.url),
    "utf8",
  );

  // The first port is the origin every note is stored under. Moving it is a
  // data-loss change, never a refactor; the fleet's allocation (8311 is
  // notes') is listed in every wrapper's `local-server.ts`.
  it("serves on notes' own ports, first 8311", () => {
    expect(source).toMatch(
      /const PORT_LADDER = \[8311, 8312, 8313\] as const;/,
    );
  });

  // App Transport Security blocks `http://127.0.0.1` from WKWebView; the
  // exception is declared for `localhost` in `native/app.config.js`.
  it("addresses the server as localhost", () => {
    expect(source).toMatch(/const HOSTNAME = "localhost";/);
  });
});
