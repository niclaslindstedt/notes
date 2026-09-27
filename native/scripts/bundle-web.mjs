// Builds the web app for the wrapper and packs it into one asset —
// `native/assets/webroot.zip` — that the wrapper bundles, unpacks on first
// launch and serves over a loopback HTTP server (src/local-server.ts). That is
// what makes the app self-contained: the notes app runs entirely on-device and
// changes only when a new build ships to the store.
//
// The web build is `npm run build:native` at the repo root
// (`VITE_TARGET=native`, output `native/web/`): the build that carries the
// listing name (`APP_DISPLAY_NAME`), has no service worker and no Donate link,
// and folds into one chunk — see `vite.config.ts`. Its relative asset base
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

if (!skipBuild) {
  console.log(
    `• building the web app (npm run build:native) — profile ${profile}…`,
  );
  execFileSync(NPM, ["run", "build:native"], {
    cwd: REPO_DIR,
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

// Deterministic zip: every entry pinned to the ZIP epoch (1980-01-01), so the
// artifact is reproducible instead of drifting with the clock.
const zipped = zipSync(files, { mtime: new Date("1980-01-01T00:00:00Z") });
mkdirSync(dirname(OUT_ZIP), { recursive: true });
writeFileSync(OUT_ZIP, zipped);

console.log(
  `✓ wrote ${OUT_ZIP} — ${count} files, ${(zipped.length / 1024).toFixed(0)} KB`,
);
