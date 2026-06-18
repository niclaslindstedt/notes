---
name: update-readme
description: "Use when README.md may be stale. Discovers commits since the last README update, identifies what user-facing surfaces changed, and brings README.md back into sync."
---

# Updating the README

**Governing spec sections:** §3 (`README.md` — required sections and content), §21.5 (this skill is mandated because `README.md` is a drift-prone artifact).

`README.md` is the primary user-facing documentation for notes. Per §3 of `OSS_SPEC.md` it must cover the project description, installation, a quick-start, usage, a contribution pointer, license, and a link to `OSS_SPEC.md`. notes is a **browser PWA, not a CLI** — there are no flags or subcommands to tabulate. It goes stale whenever a build/test command, a storage backend, a supported browser/platform, an install step, or a headline feature changes without a matching edit.

## Tracking mechanism

`.agent/skills/update-readme/.last-updated` contains the git commit hash from the last successful run. Empty means "never run" — fall back to the initial commit of the repository.

## Discovery process

1. Read the baseline:

   ```sh
   BASELINE=$(cat .agent/skills/update-readme/.last-updated)
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
| `src/storage/**` — a new or changed backend, encryption, offline   | **Features** / **Storage** list                          |
| A new user-facing feature (editor, namespaces, theming, …)         | **Features** list                                        |
| Browser/platform support (e.g. File System Access API gating)      | **Supported browsers / platforms** list                 |
| Install / PWA install steps, `.nvmrc`, prerequisites               | **Install** / **Install as a PWA** / **Quick start**     |
| License change                                                     | **License** section, badges                              |
| A move of `OSS_SPEC.md` or the conformance posture                 | The **link to `OSS_SPEC.md`**                            |

Extend this table every time you find a new source-of-truth file that feeds the README.

## Required sections (§3)

Keep the README covering, at minimum: a project description, install instructions, a quick start, a usage/features overview, a pointer to `CONTRIBUTING.md`, the license, and a link to `OSS_SPEC.md`. For notes, "usage" is framed as PWA surfaces (what the app does, how you store notes, how you install it) rather than CLI invocations.

## Update checklist

- [ ] Read baseline from `.last-updated` and run `git log` / `git diff --name-only`
- [ ] Read the current `README.md`
- [ ] Walk the mapping table and update each affected section
- [ ] Confirm every required §3 section is still present
- [ ] Verify every shell example is still valid (`npm run …` / `make …`)
- [ ] Run `make lint` and `make test`
- [ ] Write the new baseline:

      git rev-parse HEAD > .agent/skills/update-readme/.last-updated

## Verification

1. Re-read every edited section against the corresponding source of truth.
2. Confirm `.last-updated` was rewritten with the new `HEAD`.

## Skill self-improvement

After a run, improve this file in place:

1. **Grow the mapping table** with any new source → README relationship you discovered.
2. **Record patterns** for recurring edits.
3. **Commit the skill edit** together with the README edit so the knowledge compounds.
