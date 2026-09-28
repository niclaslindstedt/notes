// The phone wrapper's copy of the site (`native/scripts/bundle-web.mjs`) must
// not carry a service worker. The phone app changes only when the store
// delivers a new build, and a worker in the WebView would go on serving the
// copy it cached; `build:native` leaves it out, and the bundle script refuses
// a webroot that has one anyway — a website build copied into `native/web/`.

import { describe, expect, it } from "vitest";

import { serviceWorkerFiles } from "../native/scripts/service-worker.mjs";

describe("the phone bundle's service-worker refusal", () => {
  it("finds the worker, its workbox runtime and the registration helper", () => {
    expect(
      serviceWorkerFiles([
        "index.html",
        "sw.js",
        "workbox-5a1b2c3d.js",
        "registerSW.js",
        "assets/index-abc.js",
      ]),
    ).toEqual(["sw.js", "workbox-5a1b2c3d.js", "registerSW.js"]);
  });

  it("passes a phone build, which has none", () => {
    expect(
      serviceWorkerFiles([
        "index.html",
        "assets/index-abc.js",
        "assets/index-abc.css",
        "manifest.webmanifest",
      ]),
    ).toEqual([]);
  });

  it("does not mistake a file that only ends like one", () => {
    expect(serviceWorkerFiles(["assets/answsw.js", "docs/sw.json"])).toEqual(
      [],
    );
  });

  it("is what the bundle script refuses on", async () => {
    const { readFileSync } = await import("node:fs");
    const script = readFileSync(
      new URL("../native/scripts/bundle-web.mjs", import.meta.url),
      "utf8",
    );
    expect(script).toContain(
      'import { serviceWorkerFiles } from "./service-worker.mjs";',
    );
    expect(script).toMatch(/serviceWorkerFiles\(Object\.keys\(files\)\)/);
  });
});
