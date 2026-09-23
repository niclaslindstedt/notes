// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Packages the desktop app: bundles the site (scripts/bundle-web.mjs), then
// runs `tauri build` with the deployment's identity merged over the committed
// config.
//
// The committed `src-tauri/tauri.conf.json` carries the project's own name and
// a development identifier. What a store or a download is called, and the
// identifier it installs under, are facts about a deployment rather than about
// the code, so they arrive the way they do for the phone app: as
// APP_DISPLAY_NAME and APP_BUNDLE_ID, the same two variables under the same
// names in every app. Unset, a checkout packages under the development
// identity and runs.
//
// THE IDENTIFIER IS ALSO WHERE THE DATA LIVES. Each desktop webview keys its
// storage directory by it, so an installed copy's notes belong to the
// identifier it shipped under. Changing it after a release strands them.
//
// Usage:
//   node scripts/package.mjs                     # bundle, then `tauri build`
//   node scripts/package.mjs --debug             # …debug profile
//   node scripts/package.mjs --require-identity  # a release: refuse the dev identity
// Anything else is forwarded to `tauri build` (e.g. `--target <triple>`).

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WINDOWS = process.platform === "win32";
const MACOS = process.platform === "darwin";

const args = process.argv.slice(2);
const requireIdentity = args.includes("--require-identity");
const forwarded = args.filter((arg) => arg !== "--require-identity");

const displayName = process.env.APP_DISPLAY_NAME?.trim() ?? "";
const bundleId = process.env.APP_BUNDLE_ID?.trim() ?? "";

if (requireIdentity) {
  const missing = [
    ["APP_DISPLAY_NAME", displayName],
    ["APP_BUNDLE_ID", bundleId],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    console.error(
      `✗ ${missing.join(" and ")} not set. A release package needs the ` +
        `deployment's identity rather than the development one — set them as ` +
        `repository secrets. See tauri/README.md.`,
    );
    process.exit(1);
  }
}

execFileSync(process.execPath, [join(APP_DIR, "scripts", "bundle-web.mjs")], {
  cwd: APP_DIR,
  stdio: "inherit",
});

// NEVER ONLY LINKER-SIGNED on macOS. With no identity the bundler leaves the
// app with the signature the linker gave the binary, which seals no
// resources: `codesign --verify --deep --strict` fails on it, and Apple
// Silicon may refuse a downloaded copy as "damaged". An ad-hoc signature ("-")
// seals the whole bundle; a Developer ID (APPLE_SIGNING_IDENTITY, exported by
// .github/actions/apple-signing only once its certificate is imported) is the
// real thing. `||`, not `??`: an absent secret arrives as "".
const signingIdentity = process.env.APPLE_SIGNING_IDENTITY?.trim() || "-";

const override = {
  ...(displayName ? { productName: displayName } : {}),
  ...(bundleId ? { identifier: bundleId } : {}),
  ...(MACOS ? { bundle: { macOS: { signingIdentity } } } : {}),
};
const configArgs = [];
if (Object.keys(override).length > 0) {
  const file = join(mkdtempSync(join(tmpdir(), "tauri-identity-")), "id.json");
  writeFileSync(file, JSON.stringify(override));
  configArgs.push("--config", file);
}
if (displayName || bundleId) {
  console.log(
    `• packaging as ${displayName || "(project name)"} — ` +
      `${bundleId || "(development identifier)"}`,
  );
} else {
  console.log("• packaging under the development identity");
}
if (MACOS) {
  console.log(
    signingIdentity === "-"
      ? "• signing ad hoc (no Developer ID certificate)"
      : `• signing as ${signingIdentity}`,
  );
}

execFileSync(
  WINDOWS ? "npx.cmd" : "npx",
  ["tauri", "build", ...configArgs, ...forwarded],
  { cwd: APP_DIR, stdio: "inherit", shell: WINDOWS },
);
