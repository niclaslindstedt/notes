// The phone app's marketing version — what the App Store and Play show — is
// the release's: `native/app.config.js` reads it from the root package.json,
// the file the Release workflow bumps when it tags `v<version>`, so a store
// build never says a version the release history does not. EAS numbers the
// builds themselves.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

type AppConfig = { expo: { version: string } };

describe("the phone app's version", () => {
  it("is the root package.json's", () => {
    // `app.config.js` is CommonJS and reads the environment, as EAS does.
    const config = createRequire(import.meta.url)(
      "../native/app.config.js",
    ) as AppConfig;
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      version: string;
    };
    expect(config.expo.version).toBe(pkg.version);
  });

  it("leaves the build number to EAS", () => {
    const eas = JSON.parse(readFileSync("native/eas.json", "utf8")) as {
      cli: { appVersionSource?: string };
      build: { production: { autoIncrement?: boolean } };
    };
    expect(eas.cli.appVersionSource).toBe("remote");
    expect(eas.build.production.autoIncrement).toBe(true);
  });
});
