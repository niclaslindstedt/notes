// The phone app's header is the listing name. `native/scripts/bundle-web.mjs`
// hands `APP_DISPLAY_NAME` to the web build and checks what came out; the two
// decisions it makes about that name are pinned here, because a phone build
// whose header disagrees with its icon is only noticed on a device.

import { describe, expect, it } from "vitest";

import { listingName, titledWith } from "../../native/scripts/listing-name.mjs";

describe("listingName", () => {
  it("carries the listing name, trimmed", () => {
    expect(listingName("  Store Name ", "production")).toBe("Store Name");
    expect(listingName("Store Name", "preview")).toBe("Store Name");
  });

  it("falls back to the project name outside a production bundle", () => {
    expect(listingName(undefined, "preview")).toBe("");
    expect(listingName("   ", "development")).toBe("");
  });

  it("refuses a production bundle without one", () => {
    expect(() => listingName(undefined, "production")).toThrow(
      /APP_DISPLAY_NAME is not set/,
    );
    expect(() => listingName("", "production")).toThrow(
      /APP_DISPLAY_NAME is not set/,
    );
  });
});

describe("titledWith", () => {
  const html = "<head>\n    <title>Store Name</title>\n  </head>";

  it("recognises a bundle built for the name", () => {
    expect(titledWith(html, "Store Name")).toBe(true);
  });

  it("refuses one built for another name, or for none", () => {
    expect(titledWith(html, "Other Name")).toBe(false);
    expect(titledWith("<title>Notes</title>", "Store Name")).toBe(false);
  });
});
