// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Builds the website and copies its `dist/` output into `tauri/webroot/`,
// which the desktop shell serves from a private scheme (`shell/src/webroot.rs`).
// This is what makes the app self-contained: Notes runs entirely on-device,
// offline, and changes only when a new binary ships.
//
// The build is a plain `vite build` with the default base `/`, which is exactly
// what a single-origin shell wants, and ONE environment variable changes it.
//
// VITE_SHELL_BUILD drops the service worker (see `vite.config.ts`). It is about
// the medium rather than the audience: a desktop build has no deployment to
// discover an update from — a new version arrives as a new binary — so a worker
// here would precache a copy of files already on local disk and poll a
// `version.json` that never changes. It also switches the in-app update prompt
// off, which would otherwise be a toast nobody can act on.
//
// That is BUILD-TIME, so `--skip-build` copies whatever the last build left in
// `dist/` — a webroot re-copied from a plain `npm run build` carries the
// worker. Every release path builds.
//
// Usage:
//   node scripts/bundle-web.mjs               # build the site, then copy
//   node scripts/bundle-web.mjs --skip-build  # re-copy an existing dist/

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_DIR = resolve(APP_DIR, "..");
const DIST_DIR = join(REPO_DIR, "dist");
const OUT_DIR = join(APP_DIR, "webroot");
const WINDOWS = process.platform === "win32";
const NPM_COMMAND = WINDOWS ? "npm.cmd" : "npm";

const skipBuild = process.argv.includes("--skip-build");

if (!skipBuild) {
  console.log("• building the site (npm run build) — service worker OFF…");
  execFileSync(NPM_COMMAND, ["run", "build"], {
    cwd: REPO_DIR,
    stdio: "inherit",
    // Windows command shims are batch files, which Node cannot execute
    // directly (EINVAL); cmd.exe must interpret them.
    shell: WINDOWS,
    env: { ...process.env, VITE_SHELL_BUILD: "on" },
  });
}

if (!existsSync(DIST_DIR) || !statSync(DIST_DIR).isDirectory()) {
  console.error(
    `✗ no site build at ${DIST_DIR}. Run without --skip-build, or build the site first.`,
  );
  process.exit(1);
}
if (!existsSync(join(DIST_DIR, "index.html"))) {
  console.error(`✗ ${DIST_DIR} has no index.html — that is not a site build.`);
  process.exit(1);
}

// Replace wholesale rather than merge: a stale chunk left behind from a
// previous build is the exact failure that shows up as a blank window —
// index.html referencing hashed files that no longer exist, or the reverse.
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
cpSync(DIST_DIR, OUT_DIR, { recursive: true });

// …and put the tracked `.gitkeep` back, because the wholesale replacement above
// takes it with everything else. The directory is committed (empty) for one
// reason: `tauri.conf.json` declares `../webroot` as a bundle resource, so a
// fresh checkout that has not bundled yet must still have somewhere for it to
// point — otherwise `cargo build` and `make tauri-lint` fail before compiling a
// line. Without this line every bundle leaves the file staged for deletion.
writeFileSync(join(OUT_DIR, ".gitkeep"), "");

// A worker in here would be a bug rather than dead weight: it would precache
// files that are already on local disk and then serve the page from ITS copy,
// so a shell whose binary shipped a new site would go on showing the old one.
// `VITE_SHELL_BUILD` is what keeps it out, and this is the check that the
// build actually honoured it — the failure is otherwise invisible until
// somebody updates.
const worker = readdirSync(OUT_DIR).filter((name) =>
  /^sw\.(js|mjs)$/.test(name),
);
if (worker.length) {
  console.error(
    `✗ ${worker.join(", ")} is in the webroot — this build ran without ` +
      `VITE_SHELL_BUILD=on. Rebuild through this script rather than copying dist/.`,
  );
  process.exit(1);
}

// Nor may the desktop app carry what only the website may: a Donate link (the
// same rule as the App Store's guideline 3.1.1, kept for every store) or the
// achievements, which no phone or desktop build has. `VITE_SHELL_BUILD` compiles
// both out (`__EMBEDDED__`); a `dist/` left by a website build — which
// `--skip-build` would copy — carries them. Looks for whatever
// `VITE_DONATE_URL` this shell has set, the unlock notice's copy, and the
// achievements feature page's path, which the changelog's doc glob spells out.
//
// Nor a link back to the source (owner decision D17): no GitHub repository,
// issues, releases or sponsor link, and not the author's handle anywhere —
// web-edition domain, package name or meta tag included. The website keeps
// those; the app has none. Every file but a binary asset is read,
// extensionless ones too, so nothing slips past on its suffix.
const needles = [
  ["a Donate link", process.env.VITE_DONATE_URL?.trim()],
  ["the achievements", "Achievement unlocked"],
  ["the achievements feature page", "docs/features/achievements.md"],
  ["a link back to the source", "niclaslindstedt"],
].filter(([, needle]) => needle);
function textFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return textFiles(path);
    return /\.(png|ico|jpe?g|webp|gif|woff2?|ttf|otf)$/i.test(entry.name)
      ? []
      : [path];
  });
}
for (const path of textFiles(OUT_DIR)) {
  const text = readFileSync(path, "utf8");
  const hit = needles.find(([, needle]) => text.includes(needle));
  if (hit) {
    console.error(
      `✗ ${relative(REPO_DIR, path)} carries ${hit[0]} (${hit[1]}) — the ` +
        `desktop app must not. Rebuild through this script rather than ` +
        `copying dist/.`,
    );
    process.exit(1);
  }
}

console.log(`✓ webroot → ${OUT_DIR}`);
