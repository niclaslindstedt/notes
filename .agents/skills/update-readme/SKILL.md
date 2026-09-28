---
name: update-readme
description: "Use when README.md may be stale. Discovers commits since the last README update, identifies what user-facing surfaces changed, and brings README.md back into sync."
---

# Updating the README

`README.md` is the **contributor's** front page for notes: one line on what the project is, then prerequisites, install, run, build, the quality gates, the source layout, configuration, contributing, where the docs are, and the license. It deliberately carries no feature tour, no price and no "install it to your home screen" pitch — the product surface is described by `src/ui/HomePage.tsx` and `docs/`, and the README does not duplicate it. Its badge row is `ci` + `license` only. It goes stale whenever a build/test command, a prerequisite, the source layout, a configuration knob or a docs page changes without a matching edit.

## Tracking mechanism

`.agents/skills/update-readme/.last-updated` contains the git commit hash from the last successful run. Empty means "never run" — fall back to the initial commit of the repository.

## Discovery process

1. Read the baseline:

   ```sh
   BASELINE=$(cat .agents/skills/update-readme/.last-updated)
   ```

2. List commits since the baseline:

   ```sh
   git log --oneline "$BASELINE"..HEAD
   ```

3. List changed files:

   ```sh
   git diff --name-only "$BASELINE"..HEAD
   ```

4. Categorize the changes using the mapping table below.

5. Read the current `README.md` so you can preserve voice and unrelated sections while editing.

## Mapping table

| Changed files / scope                                              | README section(s) to update                              |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| What the app is / its headline behaviour                           | **Project description** / intro                          |
| `Makefile`, `package.json` scripts                                 | **Build & test commands** (the `make …` table)           |
| Install steps, `.nvmrc`, prerequisites                             | **Prerequisites** / **Install**                          |
| License change                                                     | **License** section, badges                              |
| A `src/` directory added, moved or removed                         | **Layout** table                                         |
| A page added to or removed from `docs/`                            | **Documentation** list                                   |

Extend this table every time you find a new source-of-truth file that feeds the README.

## Required sections

Keep the README covering, at minimum: what the project is, prerequisites, install, run, build, the quality gates, the source layout, a pointer to `AGENTS.md` and `CONTRIBUTING.md`, the docs list, and the license. Do not add product sections (features, usage tour, install-as-an-app) — they belong to `src/ui/HomePage.tsx` and `docs/`.

## Update checklist

- [ ] Read baseline from `.last-updated` and run `git log` / `git diff --name-only`
- [ ] Read the current `README.md`
- [ ] Walk the mapping table and update each affected section
- [ ] Confirm every required section is still present
- [ ] Verify every shell example is still valid (`npm run …` / `make …`)
- [ ] Run `make lint` and `make test`
- [ ] Write the new baseline:

      git rev-parse HEAD > .agents/skills/update-readme/.last-updated

## Verification

1. Re-read every edited section against the corresponding source of truth.
2. Confirm `.last-updated` was rewritten with the new `HEAD`.

## Skill self-improvement

After a run, improve this file in place:

1. **Grow the mapping table** with any new source → README relationship you discovered.
2. **Record patterns** for recurring edits.
3. **Commit the skill edit** together with the README edit so the knowledge compounds.
