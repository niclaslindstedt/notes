---
name: release
description: "Use when the maintainer (or an agent acting on their behalf) wants to cut a new release of the notes app. Walks the pre-flight checklist, dispatches the Release workflow, verifies the deploy at notes.niclaslindstedt.se, and links to the rollback recipe. Manual playbook — not part of the `maintenance` umbrella."
---

# Cutting a release

Releases are semver-tagged GitHub releases that promote a commit to the
production `/` slot of the GitHub Pages deploy at
`https://notes.niclaslindstedt.se`. The mechanism lives in
`.github/workflows/release.yml`; this skill is the human-friendly
checklist around it.

`release.yml` is **`workflow_dispatch`-only** and takes two inputs:
`bump` (`patch` / `minor` / `major`, default `minor`) and an optional
`commit` (a sha or ref to release from). Choose:

- `patch` — bug fixes, no visible behaviour change beyond the fix.
- `minor` — a new user-facing feature or visible behaviour change. Default.
- `major` — a breaking change to the persisted-note shape an older build
  can't read, or a deliberate UX overhaul.

Until the first release exists, `pages.yml` serves `main` at `/` (there
is no `/preview/` slot yet); the first dispatch creates the first `v*`
tag and flips `/` over to it. After that the deploy serves three slots
(see `AGENTS.md` → "Releases and changelog"): the released `v*` tag at
`/`, current `main` at `/preview/`, and an optional dispatched feature
branch at `/branch/`. Cutting a release moves `/` to the new tag and
chains straight into `pages.yml` so it goes live without waiting for the
next push.

> **Shared-origin storage caveat.** All three slots share one origin and
> `localStorage` is per-origin, so `/preview/` and `/branch/` read and
> write the **same** notes as production. Irrelevant to cutting a release,
> but keep it in mind if you poke at the deployed slots to verify.

## Pre-flight checklist

Before dispatching anything, confirm:

1. **You're on `main` and the working tree is clean.** The workflow
   refuses to release otherwise (`if: github.ref == 'refs/heads/main'`
   plus a clean-tree guard).

   ```sh
   git fetch origin main
   git checkout main && git reset --hard origin/main
   git status   # must report nothing to commit
   ```

2. **There is at least one fragment in `.changes/unreleased/`** other
   than `.gitkeep`. The collator refuses to write an empty release — if
   there are no fragments, there's nothing user-visible to ship and the
   dispatch is premature.

   ```sh
   ls -1 .changes/unreleased/ | grep -v '^\.gitkeep$'
   ```

3. **Every fragment parses.** The collator fails loudly on bad
   front-matter or an unknown `type:`, but catch it before the workflow
   runs. Dry-run the collator in a scratch copy — `make changelog
   VERSION=` is the front door; it consumes the fragments, so do it on a
   throwaway copy:

   ```sh
   TMP=$(mktemp -d)
   cp -r . "$TMP/"
   cd "$TMP" && make changelog VERSION=9.9.9   # or: node scripts/release/collate-changelog.mjs 9.9.9
   head -40 CHANGELOG.md   # eyeball the new section
   ```

   Also confirm any fragment carrying a `doc:` slug has a matching
   `docs/features/<slug>.md` — the collator emits a `feature:<slug>`
   link for it.

4. **CI is green on the latest commit on `main`.** The release workflow
   re-runs `npm run build` as a sanity step, but a red CI here is a hint
   the release will fail mid-flight.

## Dispatch

Trigger the workflow with the chosen bump:

```sh
gh workflow run release.yml -f bump=minor       # or patch / major
gh run watch                                    # follow the run
```

(If `gh` is unavailable, dispatch from the Actions tab, or use the
GitHub MCP `mcp__github__actions_run_trigger` tool.)

Don't do local work on `main` while it runs — the workflow pushes a
commit and a tag back to `main`, and anything you commit locally after
that needs rebasing.

### Releasing from an earlier commit

If `main` has advanced past the point you want to ship — e.g. a feature
landed that isn't meant for this release — pass the sha or ref via the
`commit` input:

```sh
gh workflow run release.yml -f bump=minor -f commit=<sha>
```

With `commit` set the workflow detaches onto that commit, builds the
bump + changelog commit on top of it, tags it, and pushes **only the
tag** — `main` is left untouched, since the release commit is not a
fast-forward of HEAD. Two consequences to plan for:

- **The changelog is collated from the fragments present at that
  commit**, not from current `main`. Fragments added later won't appear.
- **`main` keeps its old `package.json` version and its fragments.**
  Nothing reconciles it automatically. The workflow computes the next
  version from the highest released **tag** (not `package.json`), so the
  tag-only release stays monotonic — but before the next ordinary
  release from `main`, prune the fragments this release already consumed,
  or the next release re-ships the same notes.

`pages.yml` resolves the production slot from the highest `v*` semver tag
(not the nearest ancestor), so the tag is served at `/` even though it
sits off to the side of `main`.

## Post-flight verification

After the workflow finishes successfully:

1. **Tag and release exist.**

   ```sh
   git fetch --tags
   git tag --list 'v*' | tail -5
   gh release view "$(git tag --list 'v*' | sort -V | tail -1)"
   ```

2. **`package.json` is bumped, `CHANGELOG.md` is updated, fragments are
   gone.**

   ```sh
   git pull --ff-only
   git show --stat HEAD          # the release commit
   ls -1 .changes/unreleased/    # should only have .gitkeep
   ```

   (Skip `git pull --ff-only` for a `commit`-input release — `main` was
   deliberately left untouched there.)

3. **Pages is serving the new version at `/`.** Open
   `https://notes.niclaslindstedt.se/` and confirm the new build is
   live (hard-reload past the service worker first — notes uses
   `registerType: "prompt"`, so the waiting worker won't auto-activate;
   DevTools → Application → Service Workers → "Update on reload", or
   shift-reload, or accept the in-app UpdateToast). Then check
   `/preview/` serves the same code (since `main` now matches the tag).

4. **The new entry shows in the GitHub Release and `CHANGELOG.md`.**

## Rollback

The bundle was never published to a registry, so rollback is git-only:

```sh
TAG=vX.Y.Z   # the tag you want to undo
git fetch --tags
git push origin :refs/tags/$TAG          # delete remote tag
git tag -d $TAG                          # delete local tag
gh release delete $TAG --yes             # remove the GitHub Release
git revert HEAD --no-edit                # back out the release commit
git push origin main
```

The next push to `main` (the revert commit itself) triggers `pages.yml`;
with the highest `v*` tag now gone, it falls back to the next-highest
tag — or to serving `main` at `/` if no tags remain — until you cut a
real replacement release.

If only the changelog body was wrong, hand-edit `CHANGELOG.md` and
`gh release edit $TAG --notes-file …` without touching tags or
`package.json`.

## Service-worker kill-switch

notes registers a `vite-plugin-pwa` service worker with
`registerType: "prompt"` — **not** `autoUpdate`. The app surfaces an
`UpdateToast` and lets the user accept the new worker; the SW itself
does **not** `skipWaiting()` / `clientsClaim()`. This makes a bad
precache _stickier_ than under autoUpdate: a broken waiting worker just
sits there, and users who never accept the toast keep being served the
bad bundle from cache. A git revert alone won't dislodge it — the broken
SW is already installed in every user's browser.

The recipe is to ship a _replacement_ SW that nukes its own caches and
claims clients unconditionally (overriding the prompt model for this one
hotfix), then cut a patch release so users pick it up:

1. On a new branch, in `vite.config.ts`, temporarily drop `VitePWA(...)`
   and add a static `public/sw.js` with the kill body:

   ```js
   self.addEventListener("install", (e) => e.waitUntil(self.skipWaiting()));
   self.addEventListener("activate", (e) =>
     e.waitUntil(
       (async () => {
         const keys = await caches.keys();
         await Promise.all(keys.map((k) => caches.delete(k)));
         await self.clients.claim();
       })(),
     ),
   );
   ```

2. Cut a hotfix: `gh workflow run release.yml -f bump=patch`.
3. Users with the broken SW pick up the kill SW on their next visit; it
   wipes Cache Storage and (via `clients.claim()`) takes over the open
   tab so the next reload serves a fresh bundle from the network.
4. Once reports settle, restore the normal `VitePWA(...)` config (with
   `registerType: "prompt"`) in a follow-up PR.

> The kill SW skips the prompt deliberately — that's the whole point of a
> kill-switch. Don't carry `skipWaiting()`/`clients.claim()` back into the
> restored config; notes' normal update flow is the UpdateToast.

## Common failure modes

- **`working tree is not clean`** — the workflow saw uncommitted changes
  after `npm ci`, usually lockfile drift. Re-run `npm ci` locally, commit
  any updates, push, retry.
- **`gh: tag exists`** — a previous failed run already pushed the tag.
  Delete the orphan tag (`git push origin :refs/tags/vX.Y.Z`) or bump
  again.
- **`No fragments found`** — nothing user-visible to ship. Land a
  fragment-bearing PR first, or skip the release.

## Skill self-improvement

After a run:

1. If a new pre-flight trap bit you (a manifest field that must stay `/`,
   an OAuth redirect URI that needed registering for a new slot, a
   per-slot `VITE_BASE` value that clobbered a service worker), add it
   to the pre-flight checklist.
2. If a post-flight check proved unreliable, sharpen it.
3. Commit the skill edit alongside whatever prompted it — drift on the
   skill itself is the same kind of error this skill prevents.
