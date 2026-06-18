# Agent guidance for notes

This file is the canonical source of truth for AI coding agents working in
this repo. `CLAUDE.md`, `.cursorrules`, `.windsurfrules`, `GEMINI.md`, and
`.github/copilot-instructions.md` are symlinks to this file.

## What this is

`notes` is a local-first PWA for taking notes that works great on mobile and
desktop. It runs entirely in the browser and is served as static files —
there is **no backend**. Notes are persisted to `localStorage`. A React
Native app is planned; the platform-agnostic core under `src/domain/` is kept
framework-free so it can be reused there unchanged.

Mobile is the primary testing device. Every visible change should be checked
at a phone viewport first.

## OSS Spec conformance

This repository follows [`OSS_SPEC.md`](OSS_SPEC.md) for project layout,
documentation, automation, and governance. A copy of the spec lives at the
repository root so contributors and agents can consult it without leaving the
repo. When in doubt about a layout, naming, or workflow decision, consult the
relevant section of `OSS_SPEC.md`.

The repo was bootstrapped against the spec and is being brought into full
conformance incrementally. Run the validator to see the current gap:

```sh
bash /path/to/oss-spec/scripts/validate.sh .
```

### Deviations from OSS_SPEC

These are the spec items this repo does **not** satisfy yet, and why. The
initial scaffold took the project from 31 structural violations down to 12;
the remaining 12 are listed here so they're a deliberate, tracked backlog
rather than an accidental gap. Re-run the validator after changing anything in
this list and keep it in sync.

**Deferred — intended, but not built yet (do these as the project matures):**

- **§11.2 / §11.3 Website + SEO** — there is no marketing `website/`, and the
  SEO scaffolding (Open Graph / Twitter Card / JSON-LD, `sitemap.xml`,
  `robots.txt`, `llms.txt`, the `check-seo` and `lighthouse` workflows /
  `lighthouserc`) is absent. The deployed artifact is the app itself, served
  via `pages.yml`; a prerendered marketing surface can be ported from
  checklist later.
- **§11.4 PWA completeness** — the offline `navigateFallback` is wired in
  `vite.config.ts`, but there is no Lighthouse `pwa`-category gate
  (`lighthouserc`, min score ≥ 0.9) in CI yet.
- **§13.5 `prompts/`** — no versioned prompt library; nothing in the app uses
  one yet.
- **§19.4 Central output module** — no `src/output` semantic logging helpers
  (`status` / `warn` / `info` / `header` / `error`). This is a CLI-oriented
  requirement; a browser PWA logs to the devtools console, so this is treated
  as not-applicable rather than missing — revisit if a CLI/build tool is added.

**Deliberate, permanent deviations (not bugs — don't "fix" these):**

- **§20.2 Test file suffix** — tests use the Vitest-idiomatic `*.test.ts`
  suffix under `tests/<concern>/`, matching checklist exactly. The pinned
  `validate.sh` (spec 2.8.0) flags this because it expects a
  `_test` / `Test` / `Tests` suffix, but mirroring checklist's convention is
  the higher priority here. If the test layout is ever reorganized, keep it in
  lockstep with checklist, not with the validator.

When you close any deferred item above, delete its bullet here in the same PR.

## Build and test commands

```sh
make dev         # vite dev server (hot reload)
make build       # production build → dist/ (also emits the service worker)
make preview     # serve the production build locally
make test        # vitest run
make lint        # eslint + tsc --noEmit, zero warnings
make fmt         # prettier --write
make fmt-check   # prettier --check (CI)
make icons       # regenerate PWA icons from public/favicon.svg
```

## Commit and PR conventions

- All commits follow [Conventional Commits](https://www.conventionalcommits.org/).
- PRs are squash-merged; the **PR title** becomes the single commit on `main`,
  so it must follow conventional-commit format.
- Breaking changes use `<type>!:` or a `BREAKING CHANGE:` footer.
- A PR with a **user-visible** change ships a changeset fragment under
  `.changes/unreleased/` (see "Releases and changelog"). The `changeset` CI
  job enforces this; opt out with the `no-changelog` label.

## Releases and changelog

### Deployment slots

The app is hosted on GitHub Pages under the custom domain
**notes.niclaslindstedt.se** (set by `public/CNAME`, which Vite copies into
every build; the Pages workflow keeps a single CNAME in the root of the
artifact). `.github/workflows/pages.yml` assembles up to three slots into one
Pages artifact:

- `/` — the latest released `v*` tag. Before the first release exists, `main`
  is served here instead (no `/preview/` slot yet).
- `/preview/` — the current `main`. Every push to `main` rebuilds it.
- `/branch/` — an opt-in, stable slot for a feature branch. A maintainer
  dispatches `pages.yml` (`workflow_dispatch`) with a `branch_ref`; the build
  is force-pushed to the auto-managed `branch-deploy` orphan branch and
  rehydrated into every subsequent deploy until the next dispatch overwrites
  it. Delete `branch-deploy` to clear the slot.

The base path each slot is built with comes from `VITE_BASE` (`/`,
`/preview/`, or `/branch/`), read by `vite.config.ts`, which keys the
per-slot Workbox `cacheId`, PWA name, and navigation-fallback denylist off it
so the slots don't clobber one another's service worker on the shared origin.

> **Storage caveat.** All three slots share one origin, and `localStorage` is
> per-origin (not per-path), so `/preview/` and `/branch/` read and write the
> **same** notes as production. Namespace the storage keys by base path before
> using the preview/branch slots for destructive testing.

### Cutting a release

Releases are manual: dispatch `.github/workflows/release.yml`
(`workflow_dispatch` only) with a `bump`:

- `patch` — bug fixes, no visible behaviour change beyond the fix.
- `minor` — new user-facing feature or visible behaviour change. Default.
- `major` — breaking change to the persisted-note shape an older build can't
  read, or a deliberate UX overhaul.

The workflow collates `.changes/unreleased/` into a dated `CHANGELOG.md`
section, bumps `package.json`, tags `vX.Y.Z`, creates a GitHub Release from
that section, and chains into `pages.yml` so the tag is served at `/`
immediately. Preview locally with `make changelog VERSION=X.Y.Z` (consumes
the fragments — run on a scratch branch).

### Changeset fragments

When a PR introduces a **user-visible** change, drop a small markdown file in
`.changes/unreleased/<unix-ts>-<slug>.md`:

```
---
type: Added
title: Short title
doc: some-feature   # optional
---

One sentence users will read in the changelog.
```

`type:` is one of `Added | Changed | Fixed | Removed | Security |
Deprecated` (Keep a Changelog). `title:` (optional) is a short noun phrase
bolded at the head of the bullet; the body is a **one-sentence** summary. The
collator (`scripts/release/collate-changelog.mjs`) renders the bullet as
`- **<title>** — <summary>` and validates the front-matter at release time —
an unknown `type:`, a malformed line, or an empty body fails the run loudly.
The timestamp filename prefix keeps the lexical sort deterministic so
collation roughly mirrors commit order.

`doc:` (optional, big features only) is the slug of a **feature doc** at
`docs/features/<slug>.md` — a long-form `# Title` + explanation of one
feature. The collator appends `[Learn more](feature:<slug>)` to the bullet;
the `feature:` scheme is the link an in-app "What's new" changelog modal
(ported from checklist later) will resolve inline. Until that modal exists
the link is inert, so reach for `doc:` sparingly, and when you do add one,
create `docs/features/<slug>.md` in the same PR.

The `changeset` job in `ci.yml` enforces a fragment per PR. Pure refactors,
CI/build/test tweaks, dependency bumps, and docs-only edits pass via the
skip-list in `scripts/release/check-changeset.mjs` — extend it when adding
new "obviously not user-visible" path patterns. Opt a genuinely invisible
change out by labelling the PR `no-changelog`.

## Architecture summary

The source tree under `src/` is organized by concern, not by file type:

- `src/app/` — the root component (`App.tsx`), the entry point
  (`main.tsx`), and top-level state hooks (`use-notes.ts`).
- `src/domain/` — pure functions over the note model (`note.ts`) and a
  dependency-free Markdown parser (`markdown.ts`) the live-preview editor
  renders from. No DOM, no I/O, trivially testable. The boundary is enforced
  by eslint.
- `src/storage/` — persistence, built on a `StorageAdapter` byte contract
  (`adapter.ts`). The serialize/migrate pipeline (`serialize.ts`,
  `migrations.ts`) runs on every load/save so backends only move bytes.
  Backends: `local/` (localStorage, default), `folder/` (a picked directory
  of markdown files via the File System Access API), `dropbox/` and `gdrive/`
  (each note a markdown file in the user's own cloud). `encrypting/` and
  `cache/` are higher-order wrappers (AES-GCM at rest; offline mirror for the
  cloud backends); `markdown/codec.ts` is the one-`.md`-file-per-note codec
  the file backends share via `directory-adapter.ts`. `useStorageBackend.ts`
  selects and wires the active backend; `settings-store.ts` carries the
  appearance settings alongside the notes on the file/cloud backends.
  `namespaces.ts` (+ `namespace-store.ts`) is the **namespace** registry: a
  named bucket holding its own note document, with the active one selecting
  which storage location every backend reads/writes (a per-slug
  `localStorage` key, or a per-slug folder; the default keeps the historical
  root). The list mirrors to `namespaces.json` beside `settings.json` so it
  travels with a synced folder.
- `src/theme/` — the theme engine (`useTheme.ts`): projects the chosen
  preset onto `<html data-theme>`, which the CSS tokens key off.
- `src/styles/` — the CSS-variable token system (`theme.css`).
- `src/pwa/` — service-worker registration and update lifecycle
  (`usePwaUpdate.ts`), standalone/install detection (`standalone.ts`).
- `src/achievements/` — the achievements feature: a `catalog.ts` of
  unlockable trophies (each one a feature of the app), a pure `derive.ts`
  over an `AchState` (`{ snapshot, appearance }`) transition, an in-memory
  `bus.ts` for the manual unlocks fired from outside that state
  (folder/cloud connect, encryption, namespace create, install, undo,
  reload, conflict resolve), and the `useAchievementWatcher` mounted once in
  `App`. The unlock map lives in the synced appearance store
  (`theme/useTheme.ts`), so earned trophies travel with cloud sync; the UI
  is in `src/ui/achievements/` (the header `TrophyButton`, the four-tier
  tour modal, and the unlock-notification modal).
- `src/ui/` — presentational components (e.g. `UpdateToast.tsx`). Two of
  these are **standalone public pages** mounted by a path switch in
  `main.tsx` rather than rendered inside the app shell: `PrivacyPage.tsx`
  (served at `/privacy`) and `HomePage.tsx` (served at `/home`). Each is
  copied to its own clean URL at build time by an `emit-*-alias` plugin in
  `vite.config.ts`. See "The public pages" below.

Dependency direction: `app → ui → domain`, `app → storage → domain`.
Nothing in `domain/` may import from `ui/`, `storage/`, `app/`, or touch
the DOM. This keeps `domain/` portable to the planned React Native app.

### Where new code goes

| Adding…                                  | Put it in…                         |
| ---------------------------------------- | ---------------------------------- |
| A pure transform over the note model     | `src/domain/note.ts`               |
| A new persistence backend                | `src/storage/<backend>/index.ts`   |
| A presentational component               | `src/ui/`                          |
| Top-level state / a new view             | `src/app/`                         |
| A theme token or palette change          | `src/styles/theme.css` + `theme/`  |
| PWA / service-worker behaviour           | `src/pwa/`                         |
| A new achievement / its unlock trigger   | `src/achievements/catalog.ts`      |

### The public pages

Two routes are served outside the app shell as crawlable, log-in-free pages,
each its own component in `src/ui/` mounted by the path switch in
`src/app/main.tsx` and aliased to a clean URL by an `emit-*-alias` plugin in
`vite.config.ts`. They nest one segment deeper per deploy slot
(`/preview/home`, `/branch/privacy`, …), and their links resolve off
`import.meta.env.BASE_URL` so every slot stays self-contained.

- **`/privacy`** (`PrivacyPage.tsx`) — the privacy policy. This is the URL
  given on the Google OAuth consent screen.
- **`/home`** (`HomePage.tsx`) — the public **showcase / landing page**. It is
  the homepage Google's OAuth verification requires for the Google Drive
  scope, so it must keep meeting that bar: accurately identify the app and its
  verified domain (`notes.niclaslindstedt.se`), **fully describe what the app
  does**, **transparently explain every reason the app requests user data**
  (today: the opt-in cloud-sync backends and the exact scopes they ask for —
  Google Drive `drive.file`, the Dropbox app folder), and link to the privacy
  policy.

> **Keep `/home` in sync with the product.** Whenever you add, remove, or
> change a user-facing feature — and *especially* anything that touches what
> data the app reads/writes or which OAuth scope or third party it talks to —
> update `HomePage.tsx` in the same PR so the description stays accurate and
> complete. An out-of-date homepage is a failed Google verification, not just
> stale copy. The same applies to `PrivacyPage.tsx` for anything that changes
> what is stored or sent.

## Bringing features over from checklist

This app is modelled on [`checklist`](https://github.com/niclaslindstedt/checklist),
which shares the same stack (Vite + React + Tailwind + vite-plugin-pwa) and
the same `OSS_SPEC.md` conventions. Most features, looks, modals, and buttons
will be ported from there over time. **Use the `copy-feature` agent skill**
(`.agent/skills/copy-feature/`) to do this — it clones checklist, studies the
target feature in place, and adapts it to fit the notes domain rather than
pasting it verbatim.

## Test conventions

- Tests live under `tests/`, named `*.test.ts` / `*.test.tsx`.
- They run under vitest. Domain/storage tests run in the default `node`
  environment; a UI test opts into jsdom with a `// @vitest-environment jsdom`
  docblock at the top of the file.
- `src/domain/` is the layer that must stay covered — it is pure, so tests
  there are cheap and catch the most regressions.

## Documentation sync points

| When you change…                  | Also update…                          |
| --------------------------------- | ------------------------------------- |
| Build/test commands               | `README.md`, `CONTRIBUTING.md`, here  |
| The `src/` layout or boundaries   | This file's Architecture summary      |
| The `copy-feature` skill behaviour| `.agent/skills/copy-feature/SKILL.md` |
| A user-visible feature            | a fragment in `.changes/unreleased/`, and the `/home` showcase (`src/ui/HomePage.tsx`) |
| What data the app reads/writes/sends, or an OAuth scope | `src/ui/HomePage.tsx` **and** `src/ui/PrivacyPage.tsx` |
| Release / deploy / changelog flow | this file's "Releases and changelog"  |

## Maintenance skills

Agent skills live under `.agent/skills/` (with `.claude/skills` symlinked to
it). Each has a `SKILL.md` and a `.last-updated` marker. Most were ported from
checklist's `.agent/skills/` and adapted to the notes domain.

**Drift-sync skills** (the `maintenance` umbrella dispatches these in order):

- `maintenance` — the §21.6 umbrella: decides which sync skills are stale,
  runs each in order, and leaves one combined PR.
- `sync-oss-spec` — fetch the latest `OSS_SPEC.md` and bring the repo back into
  conformance, honouring the tracked deviations above.
- `update-docs` — bring `docs/*.md` (and `docs/features/*.md`) back in sync
  with the source of truth.
- `update-readme` — bring `README.md` back in sync with the current surface.

**Manual playbooks** (run on request, not part of `maintenance`):

- `copy-feature` — clone checklist, explore a named feature, and port it into
  this app adapted to the notes domain.
- `commit` — run the quality gates, commit, push, and open/update a PR.
- `write-changeset` — decide whether a PR needs a `.changes/unreleased/`
  fragment, and write or fold one in.
- `debug-from-logs` — turn pasted diagnostics into a root cause plus a
  regression test.
- `fix-comments` — strip changelog-style comments while keeping the
  invariant-explaining ones.
- `find-optimizations` — survey the hot paths for order-of-magnitude wins.
- `refactor` — work the `docs/refactoring-roadmap.md` backlog.
- `design` — iterate on the UI with an edit / screenshot / inspect loop.
- `tune-pwa-icons` — tune the PWA icon set generated from `public/favicon.svg`.
- `dependabot` — consolidate the open Dependabot bumps into one green PR.
- `release` — cut a release: pre-flight, dispatch `release.yml`, verify the
  deploy.
