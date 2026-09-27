#!/usr/bin/env node
// Clone a sibling repo (checklist / budget) into a local folder so a
// skill can read it — with full git history. The copy-feature skill uses
// it to study checklist.
//
// The siblings are public repositories under github.com/niclaslindstedt,
// so the clone URL is `https://github.com/niclaslindstedt/<sibling>.git`.
//
// Usage:
//   node clone-sibling.mjs <sibling> [dest] [ref]
//
//   node clone-sibling.mjs checklist            # -> /tmp/checklist     @ main
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

const dest = destArg || `/tmp/${sibling}`;
const ref = refArg || "main";
const url = `https://github.com/niclaslindstedt/${sibling}.git`;

// Start from a clean destination so each run studies current truth.
rmSync(dest, { recursive: true, force: true });

log(`Cloning ${url} (branch ${ref}) ...`);
const r = spawnSync("git", ["clone", "--branch", ref, url, dest], {
  stdio: ["ignore", "ignore", "pipe"],
  // Don't let git hang on an auth prompt.
  env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
});
if (r.status !== 0) {
  const stderr = (r.stderr || "").toString().trim();
  die(
    `git clone failed: ${stderr.split("\n").pop() || r.status}\n` +
      `Check that ${url} exists and that this environment can reach GitHub.`,
  );
}

log(`Sibling ready at ${dest} (with history).`);
process.stdout.write(`${dest}\n`);
