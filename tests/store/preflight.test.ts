// `make store-preflight` is the one command that says whether this checkout
// can ship, so it has to describe THIS app: read the store identity where the
// build reads it, and not ask for a game's Steam art or a `make` target that
// does not exist here. Run as the Makefile runs it.

import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");

function preflight(env: Record<string, string>): string {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      join(root, "scripts", "store-preflight.mjs"),
    ],
    { cwd: root, encoding: "utf8", env: { ...process.env, ...env } },
  );
  expect(result.stderr).toBe("");
  return result.stdout;
}

describe("store-preflight", () => {
  const out = preflight({
    APP_BUNDLE_ID: "se.example.notes",
    APP_DISPLAY_NAME: "Store Name",
  });

  it("reads the store identity from the variables the build reads", () => {
    expect(out).toContain("✓ bundle id se.example.notes (APP_BUNDLE_ID)");
    expect(out).toContain('✓ listing name "Store Name" (APP_DISPLAY_NAME)');
    expect(out).toContain("✓ fastlane names the app by APP_BUNDLE_ID");
    expect(out).not.toContain("could not read BUNDLE_ID");
  });

  it("asks only for what this app ships", () => {
    expect(out).not.toMatch(/\bgame\b/i);
    expect(out).not.toMatch(/steam|Mac App Store/i);
    expect(out).not.toContain("store-shots");
    expect(out).not.toContain("pwa/");
    expect(out).not.toContain("og.png");
    expect(out).not.toContain("pin the id");
  });
});
