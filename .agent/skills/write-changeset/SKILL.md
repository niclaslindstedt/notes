---
name: write-changeset
description: "Use when about to open a PR (or just after pushing one) to decide whether the change needs a `.changes/unreleased/<unix-ts>-<slug>.md` fragment. Resolves the latest `v*` tag, walks commits and existing fragments since, classifies the current change against the rules in AGENTS.md, and either writes a new fragment, folds the substance into an existing fragment, or labels the PR `no-changelog`."
---

# Writing a changeset fragment

`.changes/unreleased/*.md` is the queue that the Release workflow
collates into the next `## [X.Y.Z]` section of `CHANGELOG.md`. Every
fragment in the queue eventually surfaces in the released `CHANGELOG.md`
and the GitHub Release notes. The CI `changeset` job
(`scripts/release/check-changeset.mjs`) enforces "one fragment per
user-visible PR", but it can't tell whether the change is a _new_
user-visible thing or a follow-up bug fix on something that hasn't
shipped yet — that judgement is on the contributor.

This skill is that judgement. It decides whether the current change needs
a new fragment, an edit to an existing one, or the `no-changelog`
opt-out label, by inspecting what is already queued against what has
actually shipped.

## When to invoke

Run this skill before opening a PR for any change to `src/`, or to any
other path not in the skip-list inside
`scripts/release/check-changeset.mjs` (`SKIP_PATTERNS`). It is cheap to
run and catches both errors of omission (forgot a fragment) and errors of
commission (wrote a fragment for a fix to an unreleased feature, which
would surface a non-event in the changelog).

## Discovery process

1. **Resolve the baseline — the latest released commit.** Releases are
   tagged `vX.Y.Z`. If no tag exists yet, fall back to the repo's initial
   commit:

   ```sh
   # Fetch tags first — agent sessions sometimes start from a shallow
   # clone with no tags, which would silently fall through to the
   # initial-commit branch and classify every shipped feature as
   # "in-flight unreleased".
   git fetch --tags origin >/dev/null 2>&1 || true

   BASELINE=$(git tag --list 'v*' --sort=-v:refname | head -1)
   if [ -n "$BASELINE" ]; then
       BASELINE=$(git rev-list -n 1 "$BASELINE")
   else
       BASELINE=$(git rev-list --max-parents=0 HEAD)
   fi
   ```

   This is the cut-off: anything on `main` after `BASELINE` is "since the
   last release" and its parent fragment, if any, is still sitting
   unreleased in `.changes/unreleased/`. (Before the first release exists,
   `main` is served at `/` directly, so treat everything on `main` as
   in-flight unreleased.)

2. **List commits since the baseline.** This is what an in-flight release
   would ship:

   ```sh
   git log --oneline "$BASELINE"..HEAD
   ```

   Reading the conventional-commit subjects (`feat:`, `fix:`,
   `chore(scope):`, …) is usually enough to spot which commits introduced
   a feature and which polished or fixed it.

3. **List existing fragments — all of them — and search them for this
   change's feature.** These are the `Added` / `Changed` parents for any
   in-flight features:

   ```sh
   .agent/skills/write-changeset/list-fragments.sh
   ```

   The script prints **every** `.changes/unreleased/*.md` file with its
   front-matter and body, separated by `=== <filename> ===` headers.
   Exits with a "No unreleased fragments." note (on stderr) when the queue
   is empty.

   **Always enumerate the full queue with this script — never with
   `ls … | head`, a glob, or a guessed keyword grep.** `ls` sorts by
   timestamp prefix and `head` truncates it, so a folder fragment can sit
   below the fold while the first ten rows show none — leading you to
   "there's no parent fragment, so I'll write a new one" when in fact the
   feature is already queued and unreleased. Read the whole listing.

   Then **search it for the noun this change is about** before concluding
   no parent exists. If your PR touches "the folder glyph", grep the full
   listing for `folder`; if it touches "the sync chip", grep for `sync`:

   ```sh
   .agent/skills/write-changeset/list-fragments.sh | grep -i -C2 '<feature-noun>'
   ```

   A hit means the feature is almost certainly in-flight (step 3 of the
   decision tree) — fold into that fragment or `no-changelog`, do **not**
   open a new one. Zero hits across the _whole_ queue is the only thing
   that justifies treating the feature as already-shipped.

4. **Pull the current change's diff and intent.** What did this PR change,
   and which previous commit (if any) introduced the codepath it touches?

   ```sh
   git diff "$(git merge-base HEAD origin/main)"...HEAD --stat
   git log --follow --oneline -- <touched file(s)>
   ```

   `git log --follow` on each significantly-changed file usually points
   straight at the commit that introduced it. If that commit is newer than
   `BASELINE`, the feature is unreleased.

## Decision tree

Walk these in order; stop at the first match.

1. **Does the diff hit only paths in the skip-list (`SKIP_PATTERNS` in
   `scripts/release/check-changeset.mjs`)?** The skip-list is: `tests/`,
   `.github/`, `.agent/`, `.claude/`, `.changes/`, `docs/`, `scripts/`,
   `Makefile`, any `*.md`, `.nvmrc`, `.editorconfig`, `.prettierrc*`,
   `.prettierignore`, `.gitignore`, `.gitattributes`, `eslint.config.js`,
   `vite.config.ts`, `tsconfig*.json`, `package-lock.json`. — **No
   fragment.** CI accepts this without the label.

2. **Is the change a refactor or perf improvement with no user-visible
   effect?** Behavioural identity, same UI, same storage, same outputs.
   — **No fragment**, label the PR `no-changelog`.

3. **Does the change touch a codepath introduced _after_ `BASELINE`
   (i.e. the parent commit is in the `git log "$BASELINE"..HEAD` listing
   from step 2 of discovery)?** Then the feature is in
   `.changes/unreleased/` somewhere, not in production.

   - **Bug fix on it →** Locate the parent fragment. If the fix changes
     how the feature reads to a user (different label, new toggle gating,
     different default), edit the parent fragment to describe the
     post-fix shape. If the fix is invisible from a user description (it
     just makes the feature work as the parent fragment already claims),
     leave the parent alone. **Do not write a new fragment.** Label the PR
     `no-changelog`.

   - **Extension or polish on it →** Same rule. Fold the new behaviour
     into the parent fragment's prose if it changes the user-visible
     shape; otherwise leave it alone. **Do not write a new fragment.**
     Label the PR `no-changelog`.

4. **The codepath existed at `BASELINE` (i.e. it shipped in the most
   recent `vX.Y.Z`) and the change is a genuine post-release fix,
   addition, or change.** — **Write a new fragment.** Follow the format
   below.

## Writing the fragment

Filename: `.changes/unreleased/<unix-ts>-<slug>.md`. The `<unix-ts>` keeps
the lexical sort roughly in commit order; the `<slug>` is a short
kebab-case label for humans skimming the directory.

```sh
TS=$(date +%s)
SLUG=short-kebab-case-summary    # e.g. markdown-tables, dropbox-app-folder
$EDITOR ".changes/unreleased/${TS}-${SLUG}.md"
```

Body:

```
---
type: Added
title: Markdown tables
doc: markdown-tables
---

One sentence users will read in the changelog.
```

Front-matter keys:

- `type:` (required) — exactly one of `Added | Changed | Fixed | Removed |
  Security | Deprecated` (Keep a Changelog). See the list below.
- `title:` (optional, but expected for `Added` / `Changed`) — a short
  noun phrase naming the feature. The collator renders the bullet as
  `- **<title>** — <summary>`. A fragment with no `title:` renders as a
  bare one-line bullet (still accepted, but prefer a title for new
  features).
- `doc:` (optional) — the slug of a feature doc at
  `docs/features/<slug>.md`. The collator appends
  `[Learn more](feature:<slug>)` to the bullet. **Note: the in-app
  "What's new" / changelog modal that would resolve the `feature:` scheme
  is not built yet (a tracked deferral), so the link is currently inert.**
  Reach for `doc:` only on a genuinely large feature — one whose
  explanation runs to several paragraphs — and create the doc file in the
  same PR (below). Most fragments are title + one sentence, no `doc:`.

**Keep the body to one sentence.** The "What changed" line stays
scannable. The body is markdown (the released `CHANGELOG.md` renders
`**bold**`, `` `code` ``, links), so a key UI noun can be bolded, but
resist turning the bullet into a paragraph. The long-form explanation of
a big feature lives in its feature doc (`docs/features/<slug>.md`), not in
the fragment.

If a fragment needs a `doc:`, **create `docs/features/<slug>.md` in the
same PR** — a leading `# Title` heading, then the long-form markdown. The
resolver that bundles these into an in-app modal is not built yet, so for
now the doc lives purely as a repo file; create it anyway so it's ready
when the resolver lands and so the slug isn't a dangling reference. Feature
docs are written in plain second-person user voice.

`type:` — pick the one that matches the user-facing framing:

- **Added** — new feature, new affordance, new setting, new file-format
  support (e.g. a new `StorageAdapter` backend).
- **Changed** — visible behaviour change to an existing feature
  (rearranged UI, different default, renamed control).
- **Fixed** — bug fix on a feature that shipped in the most recent
  `vX.Y.Z`. **Not** for fixes on unreleased features — those don't get a
  fragment (see step 3 of the decision tree).
- **Removed** — feature that no longer exists. Pair with a short note
  about what replaces it, if anything.
- **Security** — vulnerability disclosure or hardening (e.g. the
  AES-GCM encrypting wrapper).
- **Deprecated** — feature still works but will be removed in a future
  release; tell the user the replacement.

Voice: second-person, present tense, user-centric ("Notes can now be
synced to a folder on disk"), not implementation-centric ("Wired the
folder backend through the directory adapter"). The fragment is read by
someone who has never read the source tree.

## Editing a parent fragment

When step 3 of the decision tree fires, the job is to update the parent
fragment, not to add a sibling. Two cases:

- **The post-fix shape is identical to what the parent already claims.**
  Leave the fragment alone — its prose is still accurate. Label the PR
  `no-changelog`.

- **The post-fix shape differs from what the parent claims.** Open the
  parent fragment and edit the body so it reads correctly for the _final_
  shape the user will see when the release ships. Keep the same
  `<unix-ts>` prefix and `type:`. The PR's squash-merge title should still
  be Conventional Commits (`fix: …`, `feat: …`) — only the fragment is
  affected. CI's `changeset` job sees the fragment file in the diff and
  accepts the PR without a new fragment.

## Verification

Before opening the PR:

1. **The skip-list path question is settled.** Run the gate locally:

   ```sh
   BASE_SHA=$(git merge-base HEAD origin/main) LABELS='[]' \
     node scripts/release/check-changeset.mjs
   ```

   Confirm the verdict matches your decision-tree outcome.

2. **The fragment (if any) parses.** Dry-run the collator in a scratch
   directory (or `make changelog VERSION=9.9.9` on a throwaway branch):

   ```sh
   TMP=$(mktemp -d)
   cp -r . "$TMP/"
   cd "$TMP" && node scripts/release/collate-changelog.mjs 9.9.9
   head -40 CHANGELOG.md
   ```

   The new bullet should appear under the right heading. A collator
   failure means the front-matter is malformed.

3. **The fragment reads correctly to a stranger.** If it's full of
   internal terminology (`StorageAdapter`, file paths), rewrite it in the
   voice of someone discovering the feature in the app.

4. **No stale sibling fragments.** If you edited a parent fragment,
   `git diff` should show exactly one fragment touched — your parent — and
   no new fragment. If you wrote a new fragment, `git status` should show
   exactly one new file under `.changes/unreleased/`.

## Common pitfalls

- **Writing `type: Fixed` for a fix on an unreleased feature.** The notes
  would say "Fixed: the new folder picker no longer flickers" — but the
  picker has never been in production, so no user saw the flicker. Fold it
  into the picker's `Added` fragment instead, or label `no-changelog`.

- **Concluding "no parent fragment exists" from a partial listing.** This
  is the trap that produces the pitfall above: you skim `ls
  .changes/unreleased/ | head`, see no `folder*` row in the first handful,
  and write a new `Fixed` fragment — while a dozen folder fragments sit
  lower in the (timestamp-sorted) directory, unreleased. Before you decide
  a feature has shipped, enumerate the **whole** queue with
  `list-fragments.sh` and grep it for the feature noun (discovery step 3).
  "I didn't see one" is not "there isn't one".

- **Writing a separate fragment for each commit in a multi-PR feature.** A
  single feature that lands across three PRs needs exactly one fragment.
  The first PR writes it; the next two edit it (if the shape changes) or
  skip it (with `no-changelog`).

- **Skipping the fragment on a `feat:` commit because "the diff is
  small".** Diff size is irrelevant — the question is whether a user sees
  a difference. A two-line patch that toggles a default _is_ user-visible.

- **Padding a fragment with implementation detail.** The user cares what
  the feature does, not which module it lives in.

- **Forgetting the showcase.** A user-visible change usually also needs
  `src/ui/HomePage.tsx` updated (and `PrivacyPage.tsx` if it changes what
  data the app reads/writes/sends or which OAuth scope it uses). The
  fragment and the showcase go in the same PR.

## Skill self-improvement

After a run:

1. If a new path consistently turns out to be "obviously not
   user-visible", add it to `SKIP_PATTERNS` in
   `scripts/release/check-changeset.mjs` and note it in the "Decision
   tree" skip-list above.
2. If the decision tree missed a recurring shape, add a row describing the
   shape and the verdict.
3. Commit the skill edit alongside the substantive PR — drift on the skill
   itself is the same kind of error this skill prevents.
