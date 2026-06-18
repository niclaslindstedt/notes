---
name: maintenance
description: "Use when you want to bring every drift-prone artifact in the notes repo back into sync. Dispatches to all individual update-* skills in the correct order, aggregates their results, and leaves a single combined PR ready to review."
---

# Maintenance

This is the umbrella skill for notes, mandated by §21.6 of `OSS_SPEC.md`. It does no rewriting itself — it decides which sync skills are stale, runs each one, and reports a combined summary. Use it when you do not know which specific artifact is out of date, or when several have likely drifted at once (for example, after a large merge).

## When to run

- After a big merge from `main` when you are not sure which surfaces moved.
- On a cadence (weekly / before a release) as a "drift sweep".
- When CI flags a staleness check but it is unclear which skill to invoke.

Do **not** use this skill for a targeted fix — if you know exactly which artifact is stale, call the corresponding `update-*` skill directly.

## Registry

The registry is the single source of truth for which sync skills exist in this repo. Every `update-*` directory under `.agent/skills/` must appear here exactly once. New sync skills get a row whenever they are created.

| Skill           | Fixes                                                                                                    | Spec sections          | Run order                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------- |
| `sync-oss-spec` | Repo contents vs. the latest `OSS_SPEC.md` fetched from GitHub (standalone — no external validator binary) | all structural §§ + §21.5 | 1 — run first so every downstream skill reads the freshest spec |
| `update-docs`   | `docs/*.md` (and `docs/features/*.md`) vs. source of truth                                               | §11.1                  | 2                                                                          |
| `update-readme` | `README.md` vs. the current public surface                                                               | §3                     | 3                                                                          |

Run order matters:

- `sync-oss-spec` runs **first** so every downstream skill sees the current spec — it may overwrite the local `OSS_SPEC.md` with the upstream copy, which downstream skills then read.
- The per-artifact skills (`update-docs`, `update-readme`) run afterwards in dependency order: a skill that reads files another skill rewrites must run _after_ that other skill.

What this registry deliberately does **not** carry:

- **No `update-prompts` row.** notes has no `prompts/` directory — its absence is a tracked, intentional deferral (§13.5) recorded in `AGENTS.md` → "Deviations from OSS_SPEC". Do not add this row or auto-create `prompts/`.
- **No `update-achievements` row.** notes has no achievements catalog or i18n surface, so there is nothing to keep in sync.
- **No `update-manpages` row.** notes is a browser PWA, not a CLI — there are no man pages and no `man/` tree. Do not add one.

## Discovery process

For each skill in the registry, decide whether it needs to run:

1. Read the skill's `.last-updated` file:

   ```sh
   BASELINE=$(cat .agent/skills/<skill>/.last-updated)
   ```

   An empty or missing file means "never run" — schedule it.

2. Diff the watched paths for that skill against the baseline:

   ```sh
   git diff --name-only "$BASELINE"..HEAD
   ```

   If any file in the skill's mapping table appears in the diff, schedule the skill.

3. Build the list of skills to run, preserving the run order from the registry.

## Execution

For each scheduled skill, in order:

1. Load `.agent/skills/<skill>/SKILL.md`.
2. Follow its discovery process, mapping table, and update checklist exactly.
3. Verify the skill's own verification section passes.
4. Record the commit hash the skill wrote to its `.last-updated`.

Between skills, do **not** commit — aggregate all edits into a single working tree so the final commit covers the whole sync sweep.

## Update checklist

- [ ] Read every skill's `.last-updated` and build the schedule
- [ ] Run each scheduled skill in registry order
- [ ] After all skills finish, run:
  - [ ] `make fmt`
  - [ ] `make lint`
  - [ ] `make test`
- [ ] Stage every touched file (including each updated `.last-updated`)
- [ ] Commit with a conventional-commit message describing the sweep
- [ ] Update `.agent/skills/maintenance/.last-updated`:

      git rev-parse HEAD > .agent/skills/maintenance/.last-updated

## Verification

1. Every scheduled skill's verification section must pass.
2. `make lint` and `make test` must pass.
3. The final diff should touch only documentation files, skill `.last-updated` files, and (rarely) small code adjustments that the skills flagged.
4. Every skill that ran must have its `.last-updated` rewritten with the same commit hash.

## Skill self-improvement

After every run, update this file:

1. **Add new sync skills to the registry.** Every new `update-*` skill must appear here, in alphabetical order, with a clear run-order slot.
2. **Adjust run order** if you discovered a hidden dependency.
3. **Record drift signals.** If a change should have triggered a skill but did not appear in any skill's mapping table, extend that skill's mapping table — not this one.
4. **Commit the skill edits** together with the drift sweep.
