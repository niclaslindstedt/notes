// The iCloud Drive seam, pinned from both ends.
//
// The page (`src/platform/icloud-host.ts`) and the wrapper
// (`native/src/icloudBridge.ts`) never import each other — `native/` is its
// own npm project — so nothing but this file stops them drifting apart: the
// property the provider installs itself under, the event it announces with,
// the method list, and the container every native declaration names. A
// mismatch in any of them is not an error anywhere; it is a storage backend
// that silently never appears, or one that writes to the wrong container.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

import { afterEach, describe, expect, it } from "vitest";

import {
  HOST_EVENT,
  HOST_PROPERTY,
  ICLOUD_REQUEST_TYPE,
  ICLOUD_SCRIPT,
  METHODS,
  isICloudRequest,
  resolveScript,
} from "../../native/src/icloudBridge.ts";
import {
  ICLOUD_HOST_EVENT,
  ICLOUD_HOST_METHODS,
  ICLOUD_HOST_PROPERTY,
  getICloudHost,
  parseICloudEntries,
  parseICloudStatus,
} from "../../src/platform/icloud-host.ts";
import { ICLOUD_FOLDER_NAME } from "../../src/storage/icloud/constants.ts";

const CONTAINER = "iCloud.se.agilator.notes";
const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("the bridge contract", () => {
  it("installs the provider where the page looks for it", () => {
    expect(HOST_PROPERTY).toBe(ICLOUD_HOST_PROPERTY);
    expect(HOST_EVENT).toBe(ICLOUD_HOST_EVENT);
    expect([...METHODS].sort()).toEqual([...ICLOUD_HOST_METHODS].sort());
  });

  it("narrows only well-formed requests", () => {
    const ok = {
      type: ICLOUD_REQUEST_TYPE,
      id: "i1",
      method: "write",
      args: ["notes/a.md", "hi"],
    };
    expect(isICloudRequest(ok)).toBe(true);
    expect(isICloudRequest({ ...ok, type: "haptics.vibrate" })).toBe(false);
    expect(isICloudRequest({ ...ok, id: "" })).toBe(false);
    expect(isICloudRequest({ ...ok, method: "rm -rf" })).toBe(false);
    expect(isICloudRequest({ ...ok, args: ["a", 1] })).toBe(false);
    // The other bridge's envelopes are never mistaken for one.
    expect(isICloudRequest({ v: 1, type: "pinnedFetch.request" })).toBe(false);
  });
});

// Run the injected script in a bare context with just enough `window` to hold
// the provider — the same thing the WebView does before the page loads.
function injectInto() {
  const posted: string[] = [];
  const events: string[] = [];
  const window: Record<string, unknown> = {
    ReactNativeWebView: { postMessage: (m: string) => posted.push(m) },
    dispatchEvent: (e: { type: string }) => events.push(e.type),
  };
  class Event {
    constructor(public type: string) {}
  }
  const context = { window, Event, Promise, JSON };
  runInNewContext(ICLOUD_SCRIPT, context);
  return {
    window,
    posted,
    events,
    run: (script: string) => runInNewContext(script, context),
  };
}

describe("the injected provider", () => {
  it("installs a host the page accepts, and announces it", () => {
    const { window, events } = injectInto();
    expect(events).toEqual([ICLOUD_HOST_EVENT]);
    (globalThis as { window?: unknown }).window = window;
    expect(getICloudHost()).not.toBeNull();
  });

  it("round-trips a call, and survives a payload built to break out of a script", async () => {
    const { window, posted, run } = injectInto();
    const host = window[HOST_PROPERTY] as {
      read(path: string): Promise<string | null>;
    };
    const pending = host.read("notes/a.md");
    const request = JSON.parse(posted[0]!) as { id: string; method: string };
    expect(request.method).toBe("read");

    const hostile =
      "\"'`</script>${x}\u2028\u2029\\\n" + "# a note that is somebody's text";
    run(resolveScript(request.id, { ok: true, value: hostile }));
    await expect(pending).resolves.toBe(hostile);
  });

  it("turns a failed answer back into a thrown error", async () => {
    const { window, posted, run } = injectInto();
    const host = window[HOST_PROPERTY] as { list(): Promise<unknown> };
    const pending = host.list();
    const { id } = JSON.parse(posted[0]!) as { id: string };
    run(resolveScript(id, { ok: false, error: "iCloud Drive is unavailable" }));
    await expect(pending).rejects.toThrow("iCloud Drive is unavailable");
  });
});

describe("getICloudHost", () => {
  it("is null where no host is installed — every browser", () => {
    (globalThis as { window?: unknown }).window = {};
    expect(getICloudHost()).toBeNull();
  });

  it("refuses a host of an unknown version or missing a method", () => {
    const methods = Object.fromEntries(
      ICLOUD_HOST_METHODS.map((m) => [m, () => Promise.resolve(null)]),
    );
    (globalThis as { window?: unknown }).window = {
      [ICLOUD_HOST_PROPERTY]: { ...methods, version: 2 },
    };
    expect(getICloudHost()).toBeNull();
    (globalThis as { window?: unknown }).window = {
      [ICLOUD_HOST_PROPERTY]: { ...methods, version: 1, remove: undefined },
    };
    expect(getICloudHost()).toBeNull();
  });
});

describe("parsing a host's answers", () => {
  it("never mistakes an unknown status for ready or unavailable", () => {
    expect(parseICloudStatus("ready")).toBe("ready");
    expect(parseICloudStatus("unavailable")).toBe("unavailable");
    expect(parseICloudStatus("maybe")).toBe("signed-out");
    expect(parseICloudStatus(undefined)).toBe("signed-out");
  });

  it("drops malformed rows one at a time", () => {
    expect(
      parseICloudEntries([
        { path: "notes/a.md", rev: "1" },
        { path: "" },
        null,
        { path: 3 },
        { path: "settings.json" },
      ]),
    ).toEqual([{ path: "notes/a.md", rev: "1" }, { path: "settings.json" }]);
    expect(parseICloudEntries("nope")).toEqual([]);
  });
});

describe("the iCloud container", () => {
  // `app.config.js` is CommonJS and reads the environment, as EAS does.
  const config = createRequire(import.meta.url)(
    "../../native/app.config.js",
  ) as {
    expo: {
      ios: {
        bundleIdentifier: string;
        entitlements: Record<string, string[]>;
        infoPlist: {
          NSUbiquitousContainers: Record<
            string,
            { NSUbiquitousContainerName: string }
          >;
        };
      };
    };
  };
  const ios = config.expo.ios;

  it("is the committed literal in the entitlements, never the bundle id", () => {
    expect(
      ios.entitlements["com.apple.developer.icloud-container-identifiers"],
    ).toEqual([CONTAINER]);
    expect(
      ios.entitlements["com.apple.developer.ubiquity-container-identifiers"],
    ).toEqual([CONTAINER]);
    expect(ios.entitlements["com.apple.developer.icloud-services"]).toEqual([
      "CloudDocuments",
    ]);
    expect(CONTAINER).not.toContain(ios.bundleIdentifier);
  });

  it("is declared for the Files app under the name the app shows", () => {
    expect(Object.keys(ios.infoPlist.NSUbiquitousContainers)).toEqual([
      CONTAINER,
    ]);
    expect(
      ios.infoPlist.NSUbiquitousContainers[CONTAINER]!
        .NSUbiquitousContainerName,
    ).toBe(ICLOUD_FOLDER_NAME);
  });

  it("is spelled the same in the native module, JS and Swift", () => {
    expect(read("native/modules/icloud-store/index.ts")).toContain(
      `ICLOUD_CONTAINER = "${CONTAINER}"`,
    );
    expect(
      read("native/modules/icloud-store/ios/ICloudStoreModule.swift"),
    ).toContain(`CONTAINER_ID = "${CONTAINER}"`);
  });
});
