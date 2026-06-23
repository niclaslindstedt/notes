#!/usr/bin/env node
// Derive the next semver bump (patch | minor | major) from the changeset
// fragments waiting in .changes/unreleased/. This is what lets the
// Release workflow run unattended: instead of a maintainer hand-picking
// the bump, it reads the same front-matter that every user-visible PR
// already drops and computes the bump from it.
//
// Mapping (each fragment contributes one level; the release takes the
// HIGHEST level across all fragments):
//
//   major  ← any fragment with `breaking: true` in its front-matter
//   minor  ← type Added | Changed | Removed | Deprecated
//   patch  ← type Fixed | Security
//
// This mirrors AGENTS.md → "Cutting a release": a new feature or any
// visible behaviour change (including removing or deprecating a feature)
// is at least a minor; a pure fix is a patch; and a change an older
// build can't survive — a break to the persisted-note shape, or a
// deliberate UX overhaul — is flagged `breaking: true` and forces a
// major. A genuinely breaking removal is therefore `type: Removed` plus
// `breaking: true`, not Removed alone.
//
// When run as a CLI the resolved word is printed to STDOUT on its own
// line so the workflow can capture it directly
// (`BUMP=$(node compute-bump.mjs)`); all diagnostics go to STDERR to
// keep that capture clean. The pure helpers are exported so the bump
// policy can be unit-tested without touching the filesystem.

import { pathToFileURL } from "node:url";

import { readFragments, isBreaking } from "./fragments.mjs";

// Ordered low→high so the index doubles as a comparable rank.
export const LEVELS = ["patch", "minor", "major"];

// type → the lowest bump that type implies. `breaking: true` overrides
// this to "major" regardless of type.
export const TYPE_LEVEL = {
  Added: "minor",
  Changed: "minor",
  Removed: "minor",
  Deprecated: "minor",
  Fixed: "patch",
  Security: "patch",
};

// The bump a single parsed fragment ({ front, type }) implies.
export function fragmentLevel(fragment) {
  return isBreaking(fragment.front) ? "major" : TYPE_LEVEL[fragment.type];
}

// The release bump for a set of fragments: the highest level any of them
// implies. Returns "patch" for an empty set — callers that want to
// refuse an empty release check length themselves.
export function computeBump(fragments) {
  let rank = 0;
  for (const fragment of fragments) {
    const idx = LEVELS.indexOf(fragmentLevel(fragment));
    if (idx > rank) rank = idx;
  }
  return LEVELS[rank];
}

function main() {
  const fragments = readFragments();

  if (fragments.length === 0) {
    console.error(
      "No fragments in .changes/unreleased/ — nothing to compute a bump from. " +
        "Add a changeset fragment, or skip the release until something " +
        "user-visible lands.",
    );
    process.exit(1);
  }

  for (const fragment of fragments) {
    const breaking = isBreaking(fragment.front) ? " (breaking)" : "";
    console.error(
      `${fragment.file}: ${fragment.type}${breaking} → ${fragmentLevel(fragment)}`,
    );
  }

  const bump = computeBump(fragments);
  console.error(`Resolved bump from ${fragments.length} fragment(s): ${bump}`);
  console.log(bump);
}

// Only run the CLI when invoked directly, not when imported by a test.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
