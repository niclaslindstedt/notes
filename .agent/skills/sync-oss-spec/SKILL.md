---
name: sync-oss-spec
description: "Use when notes may have drifted from OSS_SPEC.md. Fetches the latest spec from GitHub, walks its mandates, and fixes each violation so the repository keeps conforming. Runs standalone — it does not shell out to any external validator binary. Consults AGENTS.md for the intentional deviations it must not 'fix'."
---

# Syncing notes with OSS_SPEC.md

**Governing spec sections:** the entire `OSS_SPEC.md` (this skill is the propagation channel for every structural mandate), plus §21.5 (which recommends every project claiming conformance to the spec ship a `sync-oss-spec` skill).

`OSS_SPEC.md` is the specification this repository claims to conform to. This skill brings the repository back into conformance whenever the spec moves or the repo drifts. It is fully standalone: it fetches the canonical spec from GitHub, walks the mandates by hand, and fixes each gap it finds on disk. **Do not depend on any external validator binary** — notes does not ship the `oss-spec` CLI, so this skill must run end-to-end on its own.

## Respect the tracked deviations first

`AGENTS.md` → "Deviations from OSS_SPEC" is the **authority** on which gaps are intentional. notes is brought into conformance incrementally, so several spec items are deliberately unsatisfied or not-applicable. Read that section at the start of every run and **do not "fix" anything it lists** — re-creating a deferred artifact or renaming an intentionally-named file is drift in the other direction. The current intentional set:

- **§13.5 `prompts/`** — notes has **no** `prompts/` directory, by design (deferred). Do **not** auto-create it; treat its absence as conformant.
- **§19.4 central output module** — **N/A** for a browser PWA. notes logs to the devtools console, so there is no `src/output` module to add; treat as not-applicable, not missing.
- **§20.2 test-file suffix** — notes uses the Vitest-idiomatic `*.test.ts` suffix under `tests/<concern>/`, a **deliberate, permanent** deviation. The pinned `validate.sh` flags it because it expects `_test`/`Test`; that is expected. Do **not** rename the tests.
- **§11.2 / §11.3 website + SEO** and **§11.4 PWA Lighthouse gate** — deferred (no marketing `website/`, no SEO scaffolding, no Lighthouse `pwa` gate yet). Do not scaffold these unless the task is explicitly to close that deferral.

When you genuinely close a deferred item, delete its bullet from `AGENTS.md` in the same PR.

## Tracking mechanism

`.agent/skills/sync-oss-spec/.last-updated` contains the git commit hash of the last successful run. Empty means "never run" — use the repo's initial commit (`git rev-list --max-parents=0 HEAD`) as the baseline.

## Fetch the canonical spec

The upstream source of truth is the `main` branch of `niclaslindstedt/oss-spec`. Pull it into a scratch file at the start of every run:

```sh
SPEC_URL="https://raw.githubusercontent.com/niclaslindstedt/oss-spec/main/OSS_SPEC.md"
SPEC_TMP="$(mktemp -t oss-spec.XXXXXX.md)"
curl -fsSL "$SPEC_URL" -o "$SPEC_TMP"
```

If `curl` is unavailable, fall back to `wget -qO "$SPEC_TMP" "$SPEC_URL"`. Never proceed with a stale local copy — a failed fetch is a hard stop, not a silent skip.

Record the upstream spec version so every downstream decision is made against a known target:

```sh
SPEC_VERSION=$(awk '/^version:/ {print $2; exit}' "$SPEC_TMP")
echo "upstream OSS_SPEC.md version: $SPEC_VERSION"
```

Compare the fetched copy against the local one (if any) and overwrite on drift:

```sh
if [ -f OSS_SPEC.md ]; then
  diff -u OSS_SPEC.md "$SPEC_TMP" || cp "$SPEC_TMP" OSS_SPEC.md
else
  cp "$SPEC_TMP" OSS_SPEC.md
fi
```

## Discovery process

1. Read the baseline and list every commit that may have introduced drift since then:

   ```sh
   BASELINE=$(cat .agent/skills/sync-oss-spec/.last-updated)
   git log --oneline "$BASELINE"..HEAD
   git diff --name-only "$BASELINE"..HEAD
   ```

2. Walk the **structural mandates** in the freshly-fetched spec (`$SPEC_TMP`) and assert each on disk. The checks below mirror every §19 conformance rule in the spec, **adapted to the notes topology**. Run each one and record failures — any output means a violation. Cross out any failure that the "Respect the tracked deviations" list above marks intentional.

   ```sh
   # §2/§3/§4/§5/§6/§7/§8.4/§9/§19 — required root files
   for f in LICENSE README.md CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md \
            AGENTS.md CHANGELOG.md Makefile .gitignore .editorconfig; do
     [ -e "$f" ] || echo "MISSING: $f"
   done

   # §7.1 — AGENTS.md is canonical; these five must be symlinks pointing to it
   for link in CLAUDE.md .cursorrules .windsurfrules GEMINI.md \
               .github/copilot-instructions.md; do
     [ -L "$link" ] || echo "NOT-A-SYMLINK: $link (must point to AGENTS.md)"
   done

   # §10/§11/§15 — required directories. NOTE: no prompts/ here — its absence
   # is an intentional §13.5 deferral recorded in AGENTS.md. Do not flag it.
   for d in .github/workflows .github/ISSUE_TEMPLATE docs scripts; do
     [ -d "$d" ] || echo "MISSING-DIR: $d"
   done

   # §10.1/§10.3/§10.4 — required workflows for notes. There is NO
   # version-bump.yml in this repo; releases are dispatched via release.yml.
   for w in ci.yml release.yml pages.yml; do
     [ -f ".github/workflows/$w" ] || echo "MISSING-WORKFLOW: $w"
   done

   # §10.3 — no floating toolchain specifiers in CI workflows
   grep -nE '(node-version:)[^\n]*\b(latest|lts|\*)\b' \
        .github/workflows/ci.yml .github/workflows/release.yml 2>/dev/null

   # §10.5 — local pin file matches CI. notes is a Node project: .nvmrc must
   # exist and match the version ci.yml installs. Cross-check the value by eye.
   [ -f package.json ] && { [ -f .nvmrc ] || echo "MISSING: .nvmrc"; }

   # §15 — issue + PR templates
   for f in .github/PULL_REQUEST_TEMPLATE.md \
            .github/ISSUE_TEMPLATE/bug_report.md \
            .github/ISSUE_TEMPLATE/feature_request.md \
            .github/ISSUE_TEMPLATE/config.yml \
            .github/dependabot.yml; do
     [ -f "$f" ] || echo "MISSING: $f"
   done

   # §19.4 — central output module: N/A for a browser PWA (logs to the devtools
   # console). AGENTS.md records this as not-applicable; do NOT add src/output.

   # §20.2 — test-file suffix: notes deliberately uses *.test.ts under
   # tests/<concern>/. The pinned validator flags this; that is intentional
   # (AGENTS.md). Do NOT rename tests. Listed here only so the deviation is
   # visible, not actioned.

   # §20.5 — source files over the 1000-line cap (a hard signal; see mapping)
   find src -name '*.ts' -o -name '*.tsx' | while read -r f; do
     n=$(wc -l < "$f")
     [ "$n" -gt 1000 ] && echo "LARGE-FILE: $f ($n lines)"
   done

   # §21 — agent skills tree
   [ -d .agent/skills ] || echo "MISSING-DIR: .agent/skills"
   [ "$(readlink .claude/skills)" = "../.agent/skills" ] \
     || echo "BAD-SYMLINK: .claude/skills -> ../.agent/skills"
   for d in .agent/skills/*/; do
     [ -f "$d/SKILL.md" ]      || echo "MISSING: $d/SKILL.md"
     [ -f "$d/.last-updated" ] || echo "MISSING: $d/.last-updated"
   done
   ```

3. For each failure, re-read the relevant section of `$SPEC_TMP` so the fix matches the spec's intent rather than silencing the symptom:

   ```sh
   # Jump to a section, e.g. §21, in the fetched spec.
   awk '/^## 21\. /,/^## 22\. /' "$SPEC_TMP"
   ```

## Mapping table

Skip any row that `AGENTS.md` marks as an intentional deviation (the §13.5 / §19.4 / §20.2 / §11.x rows below are listed only so you recognize and **don't** action them).

| Violation spec section                                          | Where to fix it                                                                                                                                                              |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §2 missing `LICENSE`                                            | Create `LICENSE` with the SPDX-identified license text and the correct copyright holder                                                                                      |
| §3 missing `README.md` sections                                 | Edit `README.md`; hand off to `update-readme` if extensive rewording is needed                                                                                               |
| §4/§5/§6 missing `CONTRIBUTING.md` / `CODE_OF_CONDUCT.md` / `SECURITY.md` | Create the file with the minimum content mandated by the corresponding spec section                                                                                |
| §7.1 a tool-specific guidance file is not a symlink             | Replace the regular file with `ln -s AGENTS.md <path>` (or `ln -s ../AGENTS.md .github/copilot-instructions.md`). The five symlinks are `CLAUDE.md`, `.cursorrules`, `.windsurfrules`, `GEMINI.md`, `.github/copilot-instructions.md` |
| §8.4 missing `CHANGELOG.md`                                     | Create an empty Keep-a-Changelog-formatted file; do **not** hand-author entries                                                                                              |
| §9 Makefile target missing                                      | Add the missing target to `Makefile` and verify it runs end-to-end (notes targets: `install`, `dev`, `build`, `preview`, `test`, `lint`, `fmt`, `fmt-check`, `icons`, `changelog`, `clean`) |
| §10.1/§10.3/§10.4 missing workflow                              | Create `.github/workflows/<file>.yml`. Required for notes: `ci.yml`, `release.yml`, `pages.yml` (there is no `version-bump.yml`)                                              |
| §10.3 floating or under-pinned toolchain                        | Edit the workflow to pin the Node version at or above the minimum declared in the fetched `OSS_SPEC.md` §10.3 table                                                           |
| §10.5 missing pin file / pin ↔ CI mismatch                      | Add or align `.nvmrc` with the Node version `ci.yml` installs                                                                                                                |
| §11.1 missing `docs/` content                                  | Create the topic file, then hand off to `update-docs`                                                                                                                        |
| §11.2/§11.3 website + SEO                                       | **Intentional deferral** (AGENTS.md) — do not scaffold unless explicitly tasked                                                                                              |
| §11.4 PWA Lighthouse gate                                       | **Intentional deferral** (AGENTS.md) — do not add `lighthouserc`/the gate unless explicitly tasked                                                                           |
| §13.5 `prompts/`                                                | **Intentional deferral** (AGENTS.md) — notes has no prompts; do **not** create `prompts/`                                                                                    |
| §15 missing issue / PR templates                                | Create the templates under `.github/ISSUE_TEMPLATE/` or `.github/PULL_REQUEST_TEMPLATE.md`                                                                                    |
| §19.4 central output module                                     | **Not applicable** to a browser PWA (AGENTS.md) — do **not** add `src/output`                                                                                                |
| §20.2 test file suffix                                          | **Deliberate deviation** (AGENTS.md) — notes uses `*.test.ts`; do **not** rename                                                                                             |
| §20.5 source file exceeds 1000 lines                            | **Preferred:** split the file by concern into sibling modules (e.g. a fat `src/storage/<backend>/index.ts` into the adapter plus its codec/helpers). **Escape hatch:** add `oss-spec:allow-large-file: <reason>` in a comment within the first 20 lines — the reason must be non-empty and genuinely justify the size (cohesive state machine, generated code, inherent token-table density). |
| §21.2 `.claude/skills` is not a symlink                         | Replace it with `ln -s ../.agent/skills .claude/skills`                                                                                                                       |
| §21.3 SKILL.md missing front-matter fields                      | Add `name:` / `description:` to the front matter                                                                                                                             |
| §21.4 missing `.last-updated`                                   | `git rev-parse HEAD > .agent/skills/<skill>/.last-updated`                                                                                                                    |
| §21.5 missing required `update-*` skill                         | Create `.agent/skills/<skill>/SKILL.md` (+ `.last-updated`); register it in `maintenance/SKILL.md`                                                                            |
| §21.6 `maintenance` skill registry row missing                  | Add the row in `maintenance/SKILL.md`, alphabetical, with a run-order slot                                                                                                    |

## Update checklist

- [ ] Read `AGENTS.md` → "Deviations from OSS_SPEC" so you skip the intentional gaps
- [ ] Fetch `$SPEC_URL` into `$SPEC_TMP`; abort on failure
- [ ] Compare `$SPEC_TMP` with local `OSS_SPEC.md`; overwrite the local copy on drift
- [ ] Read the baseline from `.last-updated` and diff the working tree
- [ ] Walk every structural check in "Discovery process" step 2 and collect failures
- [ ] For each failure **not** covered by a tracked deviation, read the matching section of `$SPEC_TMP` and apply the fix
- [ ] Re-run every shell check from step 2 — it must produce no output beyond the known intentional deviations
- [ ] Run `make fmt`, `make lint`, `make test`
- [ ] Write the new baseline:

      git rev-parse HEAD > .agent/skills/sync-oss-spec/.last-updated

## Verification

1. Every shell check in "Discovery process" step 2 prints nothing except the deviations `AGENTS.md` tracks as intentional.
2. `diff OSS_SPEC.md "$SPEC_TMP"` is empty.
3. `make lint` and `make test` pass.
4. Every actionable failure seen before this run has a matching edit in the diff — no violation was silenced by loosening a check, and no intentional deviation was "fixed".
5. `.last-updated` was rewritten with the current `HEAD`.

## Skill self-improvement

After a run, extend this file:

1. **Grow the mapping table** whenever a new §X.Y section starts producing violations that the table does not yet cover.
2. **Extend the step-2 shell checks** whenever a new mandate lands upstream — the checks must stay a faithful, binary-free mirror of the spec's structural rules, adapted to the notes topology.
3. **Keep the deviation list in lockstep with `AGENTS.md`.** When a deferral is closed there, drop it from the "do not fix" carve-outs here in the same PR.
4. **Record fix recipes** (exact commands or edit patterns) for violations that required more than a one-line change.
5. **Commit the skill edit** alongside the repo fixes so the knowledge compounds.
