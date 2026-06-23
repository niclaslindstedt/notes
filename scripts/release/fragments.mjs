#!/usr/bin/env node
// Shared reader for the .changes/unreleased/ changeset fragments.
//
// Two release scripts consume the same fragment files and must parse
// them identically: collate-changelog.mjs (renders them into a
// CHANGELOG section) and compute-bump.mjs (derives the semver bump from
// their front-matter). Keeping the front-matter grammar in one place
// stops the two from drifting — a fragment that collates cleanly is the
// same fragment the bump is computed from.
//
// Fragment format:
//
//   ---
//   type: Added         # one of Added | Changed | Fixed | Removed | Security | Deprecated
//   title: Short title  # optional — bolded at the head of the bullet
//   doc: deployment     # optional — links to docs/features/<doc>.md
//   breaking: true      # optional — forces a major bump (see compute-bump.mjs)
//   ---
//
//   One-sentence user-facing summary.
//
// Fragments without front-matter, with an unknown `type`, with a
// malformed front-matter line, or with an empty body fail loudly.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const TYPES = [
  "Added",
  "Changed",
  "Fixed",
  "Removed",
  "Security",
  "Deprecated",
];

export const FRAG_DIR = ".changes/unreleased";

// The set of front-matter values that read as "yes" for a boolean flag
// like `breaking`. Anything else (including absent) is false.
const TRUTHY = new Set(["true", "yes", "1"]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

// Real fragments end in .md; the .gitkeep sentinel and any dotfiles are
// skipped. Sorted lexically — the <unix-ts>- filename prefix makes that
// roughly track commit order.
export function listFragmentFiles(dir = FRAG_DIR) {
  return readdirSync(dir)
    .filter((n) => n.endsWith(".md") && !n.startsWith("."))
    .sort();
}

export function parseFragment(file, dir = FRAG_DIR) {
  const raw = readFileSync(join(dir, file), "utf8");
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/.exec(raw);
  if (!m) {
    fail(
      `bad fragment ${file}: missing front-matter. ` +
        `Expected:\n---\ntype: Added\ntitle: Short title\n---\n\n<summary>`,
    );
  }
  // Parse the front-matter block as simple `key: value` lines.
  const front = {};
  for (const line of m[1].split("\n")) {
    if (line.trim() === "") continue;
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!kv) {
      fail(`bad fragment ${file}: malformed front-matter line "${line}"`);
    }
    front[kv[1].trim()] = kv[2].trim();
  }
  const type = (front.type ?? "").trim();
  if (!TYPES.includes(type)) {
    fail(`bad fragment ${file}: type "${type}" not in ${TYPES.join(", ")}`);
  }
  const body = m[2].trim();
  if (!body) {
    fail(`bad fragment ${file}: empty body`);
  }
  return { file, front, body, type };
}

export function readFragments(dir = FRAG_DIR) {
  return listFragmentFiles(dir).map((f) => parseFragment(f, dir));
}

// A fragment marks a breaking change with `breaking: true` (or yes/1) in
// its front-matter. This is the only signal that escalates a release to
// a major bump.
export function isBreaking(front) {
  return TRUTHY.has((front.breaking ?? "").trim().toLowerCase());
}
