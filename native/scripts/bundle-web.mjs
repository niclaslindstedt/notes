// Builds the web app for the wrapper and packs it into one asset —
// `native/assets/webroot.zip` — that the wrapper bundles, unpacks on first
// launch and serves over a loopback HTTP server (src/local-server.ts). That is
// what makes the app self-contained: the notes app runs entirely on-device and
// changes only when a new build ships to the store.
//
// The web build is `npm run build:native` at the repo root
// (`VITE_TARGET=native`, output `native/web/`): the build that carries the
// listing name (`APP_DISPLAY_NAME`, from the environment or `native/.env`,
// handed to the build here and required for `--profile production` — see
// `listing-name.mjs`), has no service worker, no Donate link and
// no achievements (both the website's alone, and refused below if they show
// up), and folds into one chunk — see `vite.config.ts`. Its relative asset base
// resolves under the loopback origin exactly as it does anywhere else. If the
// wrapper ever needs the web app to behave differently beyond that, it has
// stopped being thin.
//
// Usage:
//   node scripts/bundle-web.mjs                 # build the site, then zip it
//   node scripts/bundle-web.mjs --skip-build    # re-zip an existing native/web/
//   node scripts/bundle-web.mjs --profile production
//
// `--profile` is accepted (and echoed) so the CI workflow can pass the EAS
// profile through uniformly; the web build does not depend on it today.
//
// The zip is a build artifact (gitignored). Generate it before `eas build`;
// the root `.easignore` is what keeps it in the EAS upload despite that.

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { zipSync } from "fflate";

import { nativeEnv } from "../../scripts/lib/store-env.mjs";
import { listingName, titledWith } from "./listing-name.mjs";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_DIR = resolve(APP_DIR, "..");
const WEB_DIR = join(APP_DIR, "web");
const OUT_ZIP = join(APP_DIR, "assets", "webroot.zip");
const WINDOWS = process.platform === "win32";
const NPM = WINDOWS ? "npm.cmd" : "npm";

const skipBuild = process.argv.includes("--skip-build");
const profileArg = process.argv.indexOf("--profile");
const profile =
  (profileArg >= 0 ? process.argv[profileArg + 1] : undefined) ??
  process.env.EAS_BUILD_PROFILE ??
  "preview";

// The listing name, read the way the store tooling reads it: the environment
// first, then `native/.env` (which Expo loads for `app.config.js` too, so the
// name under the icon and the one in the header come from the same place).
const displayName = listingName(
  nativeEnv(REPO_DIR).value("APP_DISPLAY_NAME"),
  profile,
);
console.log(
  displayName
    ? `• the app calls itself "${displayName}" (APP_DISPLAY_NAME)`
    : "• no APP_DISPLAY_NAME — the app calls itself by the project name",
);

if (!skipBuild) {
  console.log(
    `• building the web app (npm run build:native) — profile ${profile}…`,
  );
  const buildEnv = { ...process.env, APP_DISPLAY_NAME: displayName };
  if (!displayName) delete buildEnv.APP_DISPLAY_NAME;
  execFileSync(NPM, ["run", "build:native"], {
    cwd: REPO_DIR,
    env: buildEnv,
    stdio: "inherit",
    // npm on Windows is a batch shim, which Node cannot execute directly.
    shell: WINDOWS,
  });
}

/** Collect `native/web/` into the flat `{ "index.html": bytes }` shape fflate
 *  wants, with forward-slash paths relative to its root. */
function collect(dir, files = {}) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      collect(abs, files);
    } else {
      files[relative(WEB_DIR, abs).split("\\").join("/")] = new Uint8Array(
        readFileSync(abs),
      );
    }
  }
  return files;
}

let files;
try {
  files = collect(WEB_DIR);
} catch (error) {
  console.error(
    `\n✗ could not read ${WEB_DIR} — build the web app first ` +
      `(drop --skip-build, or run 'make build-native' at the repo root).\n`,
  );
  throw error;
}

const count = Object.keys(files).length;
if (count === 0 || !files["index.html"]) {
  throw new Error(
    `native/web/ has no index.html (${count} files) — the web build looks empty.`,
  );
}

/** Refuse a webroot that carries what only the website may: a Donate link
 *  (App Store guideline 3.1.1) or the achievements, which no phone or desktop
 *  build has. `build:native` compiles both out (`__EMBEDDED__`); a `native/web/`
 *  filled some other way — a website build copied in, then re-zipped with
 *  `--skip-build` — would carry them. Looks for whatever `VITE_DONATE_URL`
 *  this shell has set, the unlock notice's copy, and the achievements feature
 *  page's path, which the changelog's doc glob spells out.
 *
 *  Nor may it carry a link back to the source (owner decision D17): no GitHub
 *  repository, issues, releases or sponsor link, and not the author's handle
 *  anywhere — web-edition domain, package name or meta tag included. The
 *  website keeps those; the app has none. Every file but a binary asset is
 *  read, extensionless ones too, so nothing slips past on its suffix. */
const BINARY = /\.(png|ico|jpe?g|webp|gif|woff2?|ttf|otf)$/i;
function assertWebsiteOnlyAbsent(files) {
  const needles = [
    ["a Donate link", process.env.VITE_DONATE_URL?.trim()],
    ["the achievements", "Achievement unlocked"],
    ["the achievements feature page", "docs/features/achievements.md"],
    ["a link back to the source", "niclaslindstedt"],
  ].filter(([, needle]) => needle);
  const decoder = new TextDecoder();
  for (const [path, bytes] of Object.entries(files)) {
    if (BINARY.test(path)) continue;
    const text = decoder.decode(bytes);
    const hit = needles.find(([, needle]) => text.includes(needle));
    if (hit) {
      throw new Error(
        `native/web/${path} carries ${hit[0]} (${hit[1]}) — the phone app ` +
          `must not. Rebuild through this script (drop --skip-build) so ` +
          `VITE_TARGET=native compiles it out.`,
      );
    }
  }
}

assertWebsiteOnlyAbsent(files);

// The header is the listing's name, not whatever `native/web/` was last built
// with: a re-zip of a bundle built for another name (or none) would ship an app
// whose header disagrees with its icon.
if (
  displayName &&
  !titledWith(new TextDecoder().decode(files["index.html"]), displayName)
) {
  throw new Error(
    `native/web/index.html is not titled "${displayName}" — it was built ` +
      `without this APP_DISPLAY_NAME. Rebuild through this script (drop ` +
      `--skip-build).`,
  );
}

// Deterministic zip: every entry pinned to the ZIP epoch (1980-01-01), so the
// artifact is reproducible instead of drifting with the clock.
const zipped = zipSync(files, { mtime: new Date("1980-01-01T00:00:00Z") });
mkdirSync(dirname(OUT_ZIP), { recursive: true });
writeFileSync(OUT_ZIP, zipped);

console.log(
  `✓ wrote ${OUT_ZIP} — ${count} files, ${(zipped.length / 1024).toFixed(0)} KB`,
);
