#!/usr/bin/env node
// Clone a sibling repo (checklist / budget) or the shared oss-framework
// package into a local folder so a skill can read it — with full git
// history. The copy-feature skill uses it to study checklist; the
// migrate-component skill uses it to study oss-framework.
//
// These repos push-mirror themselves to an external git host (each
// repo's .github/workflows/mirror.yml). That mirror is reachable over
// plain `git` even in the scoped web sandbox where github.com egress is
// blocked (403), so we clone the mirror directly. The clone URL is just
// MIRROR_BASE with `<sibling>.git` appended.
//
// Config (env):
//   MIRROR_BASE   host + namespace of the mirrors — no scheme, no repo,
//                 e.g. `gitlab.com/niclaslindstedt`. `<sibling>.git` is
//                 appended to it to form the clone URL. REQUIRED.
//   MIRROR_TOKEN  the PAT, embedded into the URL so a *private* mirror
//                 clones; omit it for a public mirror.
//   MIRROR_USER   (optional) basic-auth username paired with the token;
//                 defaults to `oauth2` (GitLab). Use `x-token-auth` for
//                 Bitbucket, or your username for Gitea / Codeberg.
//
// Usage:
//   node clone-sibling.mjs <sibling> [dest] [ref]
//
//   node clone-sibling.mjs checklist            # -> /tmp/checklist     @ main
//   node clone-sibling.mjs oss-framework        # -> /tmp/oss-framework @ main
//   node clone-sibling.mjs budget /tmp/b        # -> /tmp/b             @ main
//   node clone-sibling.mjs checklist /tmp/c dev # -> /tmp/c             @ dev
//
// The resolved destination path is printed to STDOUT on success; all
// progress and diagnostics go to STDERR so the path can be captured
// cleanly (`DEST=$(node clone-sibling.mjs checklist)`).

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

function log(msg) {
  process.stderr.write(`${msg}\n`);
}

function die(msg) {
  log(`error: ${msg}`);
  process.exit(1);
}

const [sibling, destArg, refArg] = process.argv.slice(2);
if (!sibling) {
  die("usage: clone-sibling.mjs <sibling> [dest] [ref]");
}

const base = process.env.MIRROR_BASE;
if (!base) {
  die(
    "MIRROR_BASE is not set. Point it at the mirror host+namespace, e.g. " +
      "gitlab.com/niclaslindstedt (and set MIRROR_TOKEN for a private " +
      "mirror), then re-run.",
  );
}

const dest = destArg || `/tmp/${sibling}`;
const ref = refArg || "main";

// Build the clone URL: MIRROR_BASE + `<sibling>.git`, with the token
// embedded for a private mirror. A public mirror needs no token.
const token = process.env.MIRROR_TOKEN || "";
const user = process.env.MIRROR_USER || "oauth2";
const auth = token ? `${user}:${token}@` : "";
const url = `https://${auth}${base.replace(/\/+$/, "")}/${sibling}.git`;
// Never print the embedded credential to the log.
const safeUrl = url.replace(/\/\/[^@/]+@/, "//");

// Start from a clean destination so each run studies current truth.
rmSync(dest, { recursive: true, force: true });

log(`Cloning ${safeUrl} (branch ${ref}) ...`);
const r = spawnSync("git", ["clone", "--branch", ref, url, dest], {
  stdio: ["ignore", "ignore", "pipe"],
  // Don't let git hang on an auth prompt for a private mirror.
  env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
});
if (r.status !== 0) {
  const stderr = (r.stderr || "").toString().trim();
  die(
    `git clone failed: ${stderr.split("\n").pop() || r.status}\n` +
      `Check that ${base.replace(/\/+$/, "")}/${sibling}.git exists and, if ` +
      `it is private, that MIRROR_TOKEN is valid.`,
  );
}

log(`Sibling ready at ${dest} (with history).`);
process.stdout.write(`${dest}\n`);
