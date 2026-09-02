# Agent guidance for notes

This file is the canonical source of truth for AI coding agents working in
this repo. `CLAUDE.md`, `.cursorrules`, `.windsurfrules`, `GEMINI.md`, and
`.github/copilot-instructions.md` are symlinks to this file.

## What this is

`notes` is a local-first PWA for taking notes that works great on mobile and
desktop. It runs entirely in the browser and is served as static files —
there is **no backend**. Notes are persisted to `localStorage`. A React
Native (Expo) app lives under [`native/`](native/README.md) — a **thin
WebView wrapper** that embeds the compiled web app (built by `make
build-native`) and loads it offline from local files. It adds only the two
capabilities a WebView can't provide: native haptics and SPKI-pinned HTTPS
for the self-hosted **notesd** backend, bridged over `postMessage` through
[`src/platform/native-bridge.ts`](src/platform/native-bridge.ts). It no
longer imports the web source or ships its own storage backends — the
embedded app runs its own `localStorage`.

An Electron desktop app lives under [`electron/`](electron/README.md) — a
**thin window** around the same compiled web app (built by `make
build-electron`), served from a private `notes://app` scheme so
`localStorage` gets a stable origin. It adds no capabilities at all; it is
one file, `electron/main.js`. See "The wrappers are thin" below.

Mobile is the primary testing device. Every visible change should be checked
at a phone viewport first.

## Finding your way around the code

The user (and the team) refer to parts of the app in plain English — "the
list", "the live-preview editor", "swipe to archive", "the sync glyph", "the
trophy button", "namespaces", "keep mine". These words rarely match filenames
one-to-one. Two docs exist so you don't have to guess, and they work as a
pair:

- **[`docs/dictionary.md`](docs/dictionary.md) is the index.** Before
  searching for code, **look the term up here first.** Each row resolves a
  word the codebase has accreted to the most specific file and the symbols to
  grep for, and stops there. Start here whenever an instruction names a
  concept that isn't a literal filename or import path.
- **[`docs/overview.md`](docs/overview.md) is the explanation.** Once the
  dictionary has pointed you at a file, **read the same term here to
  understand how that subsystem behaves and what else it touches** before you
  change it — it carries a full description for every dictionary term, under
  the same headings, one-to-one. This is where you discover the surfaces a
  change reaches beyond the one file the request named.

Look the word up in the dictionary to find the code; read the same word in the
overview to understand it. (Deep module layout and persisted-shape mechanics —
the `Snapshot` shape, the migration runner, the storage seam — live in
[`docs/architecture.md`](docs/architecture.md).)

**Keep both in lockstep with the code, in the same PR.** When you

- ship a feature that introduces a user-facing concept,
- rename a file or symbol the dictionary mentions,
- change how a feature behaves, or
- **hear the user use a word the dictionary doesn't already cover** — the
  "ah, when they said _that_ they meant _this_" moment —

add or update the entry in the **same** pull request as the code change: the
`overview.md` description (the bulk of the work) and the matching
`dictionary.md` row (often just a pointer to the file). Every dictionary term
has an overview entry and vice versa; letting either rot defeats the purpose.
If the user uses a term you can't find in `docs/dictionary.md` and can't infer
from filenames, ask before guessing — then record the answer so the next agent
doesn't have to.

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

- **§3 README shape / §11.4.6 installability in the README** — `README.md` is
  a **contributor's** front page, not a product page: prerequisites, install,
  run, build, the quality gates, the source layout, and where the docs are.
  It deliberately carries no "Why?" bullets, no feature or usage tour, no
  examples pointer, and no "add it to your home screen" paragraph — the
  product surface is described by `src/ui/HomePage.tsx` (the `/home` showcase,
  which is also what Google's OAuth verification reads) and by `docs/`, and
  the README does not duplicate it. Its badge row is `ci` + `license` only.
  `update-readme` and `sync-oss-spec` must keep it that way rather than
  restoring the §3 product sections.

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
make dev-seed    # dev server seeded with realistic fake data (VITE_SEED)
make build       # production build → dist/ (also emits the service worker)
make build-electron  # build the app into electron/webroot/ for the desktop shell
make preview     # serve the production build locally
make test        # vitest run
make lint        # eslint + tsc --noEmit, zero warnings
make fmt         # prettier --write
make fmt-check   # prettier --check (CI)
make icons       # regenerate PWA icons from public/favicon.svg
```

## Development workflow

- **Run `npm install` first in a fresh checkout.** The `make` targets shell
  straight into `vitest` / `eslint` / `prettier`, so they fail with
  `command not found` until dependencies are installed.
- **Run `make fmt` before committing, not just `make lint`.** Formatting is a
  separate CI gate (`fmt-check`) that `lint` won't catch — new files routinely
  trip it.
- **A user-facing feature fans out across lockstep files.** Before opening the
  PR, walk the "Documentation sync points" and "Achievements" tables and land
  the changeset fragment, the achievement (catalog + glyph + `en`/`sv`
  strings), the `en`/`sv` UI strings, and the `/home` showcase in the *same*
  PR — they're easy to forget as follow-ups.

### Seeding fake data when debugging

`src/dev/seed.ts` is the shared sample dataset, consumed two ways:

- **Env seed (`make dev-seed` / `npm run dev:seed`)** — starts the dev server
  with `VITE_SEED` set, which makes `seedDevData` populate localStorage on first
  load with several **namespaces** (Default, Work, Recipes, Travel, Journal),
  each holding notes of varying length and shape (one-liners, checklists,
  long-form Markdown, a couple of archived notes). `npm run build:seed` /
  `npm run preview:seed` bake the same flag into a production-mode build (driven
  by `.env.seed`, loaded only under `--mode seed`). This is **dev tooling, not a
  shipped feature** — no UI surface, no changeset, no achievement. It is guarded
  by a `SEED_VERSION` sentinel so it writes **once** per version (a reload keeps
  your edits; bump `SEED_VERSION` to force a re-seed), and it **overwrites the
  local document of every namespace it touches**, so it never runs under a plain
  `make dev` or a normal build.

- **In-app "Fake data" toggle (Developer settings)** — `useDevSeed`
  (`src/dev/useDevSeed.ts`) flips an in-memory flag; while on, `App` swaps the
  storage adapter for an ephemeral in-memory seed adapter
  (`src/storage/dev-seed/index.ts`) serving `buildSeedSnapshot` (the namespaces
  flattened into one document), so fake data can be previewed **without touching
  the real notes**. A reload (or turning it off) restores the real backend. This
  one **is** a user-facing feature: it ships the **Holodeck** achievement and
  its `en`/`sv` strings, the toggle's `settings.developer.fakeData*` strings,
  and a changeset — but no `/home` entry (it's a hidden dev diagnostic behind
  dev mode that reads/writes/sends no data).

## Commit and PR conventions

- All commits follow [Conventional Commits](https://www.conventionalcommits.org/).
- PRs are squash-merged; the **PR title** becomes the single commit on `main`,
  so it must follow conventional-commit format.
- Breaking changes use `<type>!:` or a `BREAKING CHANGE:` footer.
- A PR with a **user-visible** change ships a changeset fragment under
  `.changes/unreleased/` (see "Releases and changelog"). The `changeset` CI
  job enforces this; opt out with the `no-changelog` label.

### Watching a PR after you open it

Don't babysit a PR with polling. **Do not** schedule `send_later`, `CronCreate`
jobs, `ScheduleWakeup`, or any other timed self-check-in to re-poll a PR's CI
status or merge state — those just burn turns. Open the PR, confirm the checks
you can see are green, then stop. CI failures and review comments are delivered
to the session as webhook events, so you'll be woken when there's actually
something to act on. React to those events when they arrive; otherwise consider
the PR handed off.

## Releases and changelog

### Deployment slots

The app is hosted on GitHub Pages under a custom domain. **The domain is not
in the tree** — there is no `public/CNAME`; `.github/workflows/pages.yml`
writes `dist/CNAME` from the `PAGES_CNAME` repository secret, once, into the
root of the merged artifact (Pages reads only the root CNAME). With the
secret unset the deploy simply serves on the default `*.github.io` host, so a
fork needs no change. Do not reintroduce a checked-in CNAME, and do not write
the deployment hostname into source, docs, or workflow text — read it from
the secret, or, in the app, off `window.location` at runtime (which is what
`HomePage` / `PrivacyPage` do).

`.github/workflows/pages.yml` assembles up to three slots into one Pages
artifact:

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

### Two names: the project and the store listing

The repository, the Pages deploy, and the desktop archives are all **the
project**, and they all carry the project name, written down once per surface
(`vite.config.ts`'s `PROJECT_NAME`, `electron-builder.config.cjs`'s
`PRODUCT_NAME`). The **mobile store listing** is a deployment of the project,
and a deployment's coordinates are configuration, not source — so the values
that identify the app in the App Store and on Google Play are not in the tree
at all:

| Variable           | Fills                                                        |
| ------------------ | ------------------------------------------------------------ |
| `APP_DISPLAY_NAME` | `expo.name`, and the built-in wordmark of the bundle embedded in the mobile app |
| `APP_BUNDLE_ID`    | `ios.bundleIdentifier` and `android.package`                  |
| `EAS_PROJECT_ID`   | `extra.eas.projectId`                                         |

Each lives as a repository variable (forwarded by `native-build.yml`) **and**
as an EAS environment variable, because EAS resolves `native/app.config.js`
again on its own builders. Unset, each falls back to a local development
default so a plain checkout runs; a `production` build with any of them
missing throws in `app.config.js` rather than shipping under the wrong
identity.

What this means when you touch the code:

- **Never hard-code a user-visible app name.** A string that names the app
  reads `APP_NAME` (`src/build-env.ts`, from the `__APP_NAME__` define, with
  `%APP_NAME%` substituted into `index.html` by the `inject-app-name` plugin).
  That is also why the header wordmark is not an i18n string: it is a proper
  noun, identical in every language.
- **Only `VITE_TARGET=native` reads `APP_DISPLAY_NAME`.** `vite.config.ts`
  gates it on the target, so the web and Electron builds cannot pick up a
  listing name even if the variable happens to be exported. Don't remove that
  gate.
- **The project's own identity keys stay literal** — `expo.slug`, `scheme`,
  the Electron `appId`, the executable name, and the release-archive names.
  They are not listing coordinates, and changing them breaks resolution.
- **Store listing copy is not kept in the repo.** The name, description, and
  screenshots live in App Store Connect and the Play Console. Don't add a
  drafting document for them here.

### Cutting a release

Releases are manual to *trigger* but automatic to *size*: dispatch
`.github/workflows/release.yml` (`workflow_dispatch` only) and leave `bump`
on its `auto` default. The workflow derives the semver bump from the
`.changes/unreleased/` fragments' front-matter
(`scripts/release/compute-bump.mjs`), taking the **highest** level any
fragment implies:

- `patch` — only `Fixed` / `Security` fragments: bug fixes, no visible
  behaviour change beyond the fix.
- `minor` — any `Added` / `Changed` / `Removed` / `Deprecated` fragment: a new
  user-facing feature or visible behaviour change.
- `major` — any fragment flagged `breaking: true`: a breaking change to the
  persisted-note shape an older build can't read, or a deliberate UX overhaul.
  A genuinely breaking removal is `type: Removed` **plus** `breaking: true`,
  not `Removed` alone.

Set `bump` to an explicit `patch` / `minor` / `major` on dispatch only to
override that derivation. Preview the auto-derived bump locally with
`make bump` (read-only).

The workflow collates `.changes/unreleased/` into a dated `CHANGELOG.md`
section, bumps `package.json`, tags `vX.Y.Z`, creates a **draft** GitHub
Release from that section, and chains into `pages.yml` so the tag is served at
`/` immediately. Preview the changelog locally with `make changelog
VERSION=X.Y.Z` (consumes the fragments — run on a scratch branch).

In parallel it packages the [Electron desktop app](electron/README.md) on one
runner per platform — Windows zip, macOS zip for Intel **and** Apple Silicon,
Linux tar.gz — attaches the four archives to that draft, and only then
publishes it. A packaging failure therefore leaves the release a draft rather
than a public page with a missing download; the fix is to re-dispatch, or to
flip the draft by hand once the archive is uploaded. The **web** deploy does
not wait for any of that.

### Changeset fragments

When a PR introduces a **user-visible** change, drop a small markdown file in
`.changes/unreleased/<unix-ts>-<slug>.md`:

```
---
type: Added
title: Short title
doc: some-feature   # optional
breaking: true      # optional — forces a major release bump
---

One sentence users will read in the changelog.
```

`type:` is one of `Added | Changed | Fixed | Removed | Security |
Deprecated` (Keep a Changelog). `title:` (optional) is a short noun phrase
bolded at the head of the bullet; the body is a **one-sentence** summary.
`breaking:` (optional) escalates the auto-derived release bump to `major` when
the change is one an older build can't survive — set it on the one fragment
describing the break (see "Cutting a release"). Fragment parsing and
validation are shared by the collator and the bump-computer
(`scripts/release/fragments.mjs`): the collator
(`scripts/release/collate-changelog.mjs`) renders the bullet as
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

### What loads when: the code-splitting seams

The first paint carries the note-taking app and nothing else. Three seams keep
it that way, and a new feature has to be dropped through the right one or it
lands back in everyone's first download:

- **`src/app/main.tsx` routes before it loads.** The entry resolves the path,
  then dynamically imports exactly one of `ui/PrivacyPage`, `ui/HomePage`, or
  `app/mount-app.tsx` (the whole app shell). The two public pages are the
  crawlable surfaces — keep them off the app's static import graph, and keep
  the app off theirs.
- **`src/app/modals/lazy-modal.tsx` defers a modal until it opens.** Wrap an
  on-demand modal in `lazyModal` and the host stops mounting it while closed,
  so its code arrives with the first open. Settings, the changelog, both
  achievements modals, namespaces, and the sync-details dialog all go through
  it. **Not for anything that must render inside the tap that asked for it** —
  the search modal opens in a `flushSync` so iOS raises the keyboard, and an
  await there breaks it. That one stays static, deliberately.
- **`src/storage/remote-backends.ts` holds every backend that isn't
  `localStorage`.** Dropbox, Drive, Nextcloud, the picked folder and notesd —
  plus the
  directory adapter and offline-cache mirror they share — are behind one
  `import()`, because the app opens on the browser backend and stays there
  unless someone connects something. The render path reaches them through
  `useRemoteBackends`; verbs that run on a gesture (connect, delete a
  namespace, publish a daemon) use a local `await import()`. **Never import
  `remote-backends.ts` statically** — one static edge folds the whole family
  back into the first paint. The things that must answer at boot were split
  into their own small modules for exactly this reason:
  `cache/offline-error.ts`, `dropbox/pending.ts`, `cloud-configured.ts`.
- **`src/ui/export/pdf-document.ts` holds the PDF writer.** It is the only
  module that imports [jsPDF](https://github.com/parallax/jsPDF) — the app's one
  heavy runtime dependency, ~130 kB gzipped — and it is imported from the export
  handler, never at mount. **Never import it statically.** Its Unicode fallback
  faces (`src/assets/fonts/`) go one step further: they are fetched at export
  time, only when a note actually contains a character the PDF standard fonts
  can't encode, and are deliberately kept out of the service worker's precache.
  The pagination itself is pure and lives in `src/domain/pdf-layout.ts`, which
  pulls in nothing.
- **Dev-only code is imported at the point of use.** The seed dataset loads
  behind `import.meta.env.VITE_SEED` (which folds to `false` and drops the
  module in an ordinary build), and the fake-data adapter is imported when the
  toggle flips, not at mount.

**The wrappers opt out of all of it.** `vite.config.ts` sets
`inlineDynamicImports` for the embedded builds: `native/` and `electron/` ship
the bundle on the device with no network in front of it, so splitting buys them
nothing, and the native WebView serves the page from a `file://` origin where
dynamic `import()` is not dependably permitted. One chunk there, split on the
web.

### The renderer is Preact, but the imports still say `react`

The app renders with **Preact** via `preact/compat`. Nothing imports `preact`
directly: `@preact/preset-vite` aliases `react`, `react-dom`, and
`react/jsx-runtime` onto `preact/compat` for every importer — the app source
and `@niclaslindstedt/oss-framework` alike — and `tsconfig.json`'s `paths`
mirrors those aliases so `tsc` checks against the same modules Vite bundles.
So **keep writing `import { useState } from "react"`**; it resolves to Preact
either way, and switching a file to a bare `preact` import only splits the
vocabulary. React stays in `node_modules` purely to satisfy the framework's
peer range — it is never resolved by a build, and
`tests/app/preact-alias.test.ts` fails loudly if that stops being true.

Preact is not a drop-in for every React behaviour. The differences that bite,
all of them already load-bearing somewhere in `src/`:

- **`ref` is the renderer's, not a prop.** React 19 hands a function component
  its `ref` as an ordinary prop; Preact lifts `ref` off props before the
  component sees it, and only replays it through `forwardRef`. A component
  exposing an imperative handle therefore takes it as **`handleRef`**
  (`MarkdownEditor`, `PlainEditor`) — a plain prop no renderer intercepts.
- **`onSelect` is the DOM's.** React synthesised it from mouse/key activity so
  it fired on a bare caret move; Preact passes the native `select` event
  through, which browsers only emit for a *range*. Track a collapsed caret via
  `onMouseUp` / `onKeyUp` too (see `PlainEditor`).
- **`onChange` / `onBlur` / `onFocus` are remapped by compat** onto `input` /
  `focusout` / `focusin`, matching React's semantics. Real usage is unaffected;
  tests must simulate the event the DOM actually delivers (`fireEvent.input`,
  a real `el.blur()`), not the synthetic one.
- **Nullable DOM fields are visible again.** `DragEvent.dataTransfer` and
  `ClipboardEvent.clipboardData` are typed `| null` (React's synthetic events
  hid that); handlers degrade rather than assume.
- **`useSyncExternalStore` takes two arguments** — no server-snapshot.
- **JSX attribute spelling is the DOM's**: `spellcheck`, not `spellCheck`; no
  `suppressContentEditableWarning` (Preact never warns).
- **Element-typed events need their type argument** — `DragEvent<HTMLElement>`,
  not bare `DragEvent`.

### The shared framework

The app consumes
[`@niclaslindstedt/oss-framework`](https://github.com/niclaslindstedt/oss-framework)
— the common foundation extracted from `notes` and `checklist` — for its
generic components, hooks, and utilities: the UI primitives (`Modal`,
`Button`, `Checkbox`, `SelectPicker`, `FloatingPanel`, `RowActionMenu`,
`CipherGlyph`, `UnlockGate`, the settings `Section`/`Field`/`ToggleRow`,
most of the icon set), the gesture/keyboard/layout hooks (`useEscapeKey`,
`useMediaQuery`, `useRowSwipe`, `usePullToRefresh`,
`useUndoRedoShortcuts`, the drawer/floating-button hooks,
`useFloatingPosition`), the service-worker update lifecycle
(`usePwaUpdate`), the changelog parser + "What's new" modal, the
achievements engine UI (tour + unlock modals), the glyph/colour picker
kit and favicon badge builder, and the `NamespacesModal`.

The package is served from the **GitHub Packages** npm registry; `.npmrc`
authenticates the `@niclaslindstedt` scope via the `GITHUB_PAT`
environment variable (CI threads it through every `npm ci` — see the
workflows). **The historical import paths still work**: each replaced
module remains in the tree as a thin re-export shim or a wrapper that
injects the app's translated labels (the framework components take
labels-as-props with English defaults), so call sites — and the docs
dictionary — keep pointing at the same files.

**Deliberately NOT on the framework** (don't "migrate" these without a
product decision):

- **The theme system** (`src/theme/`, `src/styles/palettes.css`) — notes'
  preset vocabulary (One Dark/Light, monokai, quietLight, excel, …) has
  forked from the framework's (tokyoNight, nord, catppuccin, …); adopting
  the framework's theme data would delete user-facing presets and
  invalidate persisted appearance settings. notes' 11-slot palette is
  bridged to the framework's 18-slot vocabulary by aliases in
  `src/styles/theme.css` (meta/path/flag/pipe/success/positive/negative
  resolve onto notes' own slots) so framework components paint correctly.
- **The encryption core** (`src/storage/crypto*.ts`, `encrypting/`) —
  notes' envelope tag is `notes.encrypted.v1`; the framework writes
  `oss.encrypted.v1`. Swapping would make existing users' encrypted
  documents unreadable.
- **The i18n runtime** (`src/i18n/`) — a dependency-free runtime ported
  from checklist, diverged enough from the framework's that adopting it is
  a real port rather than a shim. (Historically this and the rest of the
  web core also had to stay framework-free because the native app imported
  them directly; the native app is now a WebView wrapper that embeds the
  compiled bundle and imports no web source, so that constraint no longer
  applies — but the divergence reason stands on its own.)
- **The Markdown parser** (`src/domain/markdown.ts`) and the
  live-preview editor — notes' parser has evolved past the framework's
  (depth-based list-marker rotation) and the editor is coupled to
  attachments and the undo timeline.
- **The undo/redo shortcuts** (`src/ui/hooks/useUndoRedoShortcuts.ts`) —
  the framework's hook stands down on every `isContentEditable` target so
  the browser's native undo wins. notes' live-preview editor deliberately
  swallows native contenteditable undo (Preact owns its DOM), so that guard
  leaves ⌘/Ctrl+Z dead while the caret sits in a note. The app-owned hook
  keeps the `<input>` / `<textarea>` / `<select>` carve-out and answers the
  shortcut inside the editor.
- **The sync UI** (`SyncStatus`, `SyncDetailsModal`), **the search
  feature** (`domain/search.ts`, `SearchModal`), **the side-menu shell**
  (`SideMenu*`), and the storage plumbing (`oauth-pkce`, `http-utils`,
  the adapters) — diverged enough that adoption is a real port, tracked
  as follow-up candidates rather than shims.

The source tree under `src/` is organized by concern, not by file type:

- `src/app/` — the root component (`App.tsx`), the entry point
  (`main.tsx`), and top-level state hooks (`use-notes.ts`).
- `src/domain/` — pure functions over the note model (`note.ts`), a
  dependency-free Markdown parser (`markdown.ts`) the live-preview editor
  renders from, the multi-cursor engine (`multi-cursor.ts`) that turns one
  keystroke into an edit at N carets, and the PDF typesetter (`pdf-layout.ts`)
  that paginates a note into pages of drawing operations. No DOM, no I/O,
  trivially testable. The boundary is enforced by eslint.
- `src/assets/` — binaries the build emits as hashed files rather than bundles.
  Today only `fonts/`: the PDF export's Unicode fallback faces, fetched on
  demand at export time. See its `README.md` for provenance and licence.
- `src/storage/` — persistence, built on a `StorageAdapter` byte contract
  (`adapter.ts`). The serialize/migrate pipeline (`serialize.ts`,
  `migrations.ts`) runs on every load/save so backends only move bytes.
  Backends: `local/` (localStorage, default), `folder/` (a picked directory
  of markdown files via the File System Access API), `dropbox/` and `gdrive/`
  (each note a markdown file in the user's own cloud), and `nextcloud/` (the
  same, over WebDAV to a Nextcloud the user runs, reached with a revocable app
  password rather than OAuth). `encrypting/` and
  `cache/` are higher-order wrappers (AES-GCM at rest; offline mirror for the
  cloud backends); `markdown/codec.ts` is the one-`.md`-file-per-note codec
  the file backends share via `directory-adapter.ts`. `attachment-store.ts` is
  the binary sibling of the markdown `FileStore`: each file backend also stores
  a note's pasted **attachments** (images and other files) as real files under
  `attachments/<note-name>/`, which the directory adapter externalises on save
  and re-hydrates on load (see `docs/overview.md#attachments`).
  `useStorageBackend.ts`
  selects and wires the active backend; `settings-store.ts` carries the
  appearance settings alongside the notes on the file/cloud backends.
  `namespaces.ts` (+ `namespace-store.ts`) is the **namespace** registry: a
  named bucket holding its own note document, with the active one selecting
  which storage location every backend reads/writes (a per-slug
  `localStorage` key, or a per-slug folder; the default keeps the historical
  root). The list mirrors to `namespaces.json` beside `settings.json` so it
  travels with a synced folder. `namespace-settings-store.ts` is the
  namespace's own slice of the appearance settings
  (`namespace-settings.json` inside the namespace folder), and
  `namespace-pin.ts` is the PBKDF2 verifier behind a namespace's optional
  **PIN**.
- `src/theme/` — the theme engine (`useTheme.ts`): projects the chosen
  preset onto `<html data-theme>`, which the CSS tokens key off. The
  persisted appearance resolves from **three sparse layers** — global /
  namespace / device, narrowest winning (`appearance-scopes.ts` over the
  pure algebra in `domain/settings-layers.ts`). See "Shared namespaces"
  below.
- `src/styles/` — the CSS-variable token system (`theme.css`).
- `src/pwa/` — service-worker registration and update lifecycle
  (`usePwaUpdate.ts`), standalone/install detection (`standalone.ts`).
- `src/platform/` — the seam to the wrappers. `native-bridge.ts`:
  `isNative()` detection, `haptics.vibrate` (native else
  `navigator.vibrate`), and `pinnedFetch`/`createPinnedFetch` (an
  SPKI-pinned `fetch` routed through native for the notesd backend). Inert
  on the plain web; only lights up inside `native/`. `capabilities.ts`: the
  single answer to **which surface is this and what can it do** — `web` /
  `native` / `desktop`, and the three capabilities that differ between them
  (`folderPicker`, `redirectOauth`, `pinnedFetch`). Every "is this available
  here?" question routes through it rather than being re-derived at the call
  site; the page works this out from what it can observe, so no wrapper has
  to tell it anything.
- `src/i18n/` — the i18n layer (ported from checklist): a dependency-free,
  typed `t()` runtime (`index.ts`) over per-language catalog modules under
  `locales/<lang>/` (English `en/` is bundled + is the `Catalog`/`MessageKey`
  type source; every other language is code-split and loaded on demand). The
  active language rides a Preact context provided by `LanguageRoot` (mounted
  around the app shell in `main.tsx`), backed by a plaintext localStorage
  mirror (`language-preference.ts`) so first paint renders in the right
  language; `locale.ts` is a framework-free code/`bcp47`/detection helper.
  English and Swedish ship today. The
  English-only public pages (`HomePage`/`PrivacyPage`) render outside
  `LanguageRoot` and are intentionally not translated.
- `src/achievements/` — the achievements feature: a `catalog.ts` of
  unlockable trophies (each one a feature of the app, its display copy in the
  `achievements` i18n namespace keyed by id), a pure `derive.ts`
  over an `AchState` (`{ snapshot, appearance }`) transition, an in-memory
  `bus.ts` for the manual unlocks fired from outside that state
  (folder/cloud connect, encryption, namespace create, install, undo,
  reload, conflict resolve), and the `useAchievementWatcher` mounted once in
  `App`. The unlock map lives in the synced appearance store
  (`theme/useTheme.ts`), so earned trophies travel with cloud sync; the UI
  is in `src/ui/achievements/` (the side-menu `AchievementsMenuItem`, the
  four-tier tour modal, and the unlock-notification modal).
- `src/ui/` — presentational components (e.g. `UpdateToast.tsx`). Two of
  these are **standalone public pages** mounted by a path switch in
  `main.tsx` rather than rendered inside the app shell: `PrivacyPage.tsx`
  (served at `/privacy`) and `HomePage.tsx` (served at `/home`). Each is
  copied to its own clean URL at build time by an `emit-*-alias` plugin in
  `vite.config.ts`. See "The public pages" below.

Dependency direction: `app → ui → domain`, `app → storage → domain`.
Nothing in `domain/` may import from `ui/`, `storage/`, `app/`, or touch
the DOM. This keeps `domain/` pure and trivially testable (no I/O, no DOM).

### The wrappers are thin — put the logic in the PWA

Two directories ship the same web app as a downloadable binary:
[`native/`](native/README.md) (React Native WebView, iOS + Android) and
[`electron/`](electron/README.md) (Electron, desktop). **Both are shells, and
they stay shells.** They embed a compiled copy of the app — built by `make
build-native` / `make build-electron`, which set `VITE_TARGET` so the bundle
gets a relative asset base and no service worker — and show it. Neither
imports anything from `src/`.

The rule for both, and the one to check a change against:

> **Anything that could live in the PWA, does.** A wrapper may only hold what
> is *impossible* in a web page on that platform, and nothing else.

For `native/` that is a short, closed list — haptics, SPKI-pinned HTTPS, QR
camera scan — each behind the `postMessage` bridge in
[`src/platform/native-bridge.ts`](src/platform/native-bridge.ts), which is
inert on the web. For `electron/` the list is **two items long**: the
remembered window bounds, because a web page cannot size or place its own OS
window, and a loopback HTTP listener for one OAuth redirect, because a web page
cannot hold a listening socket — the flow RFC 8252 prescribes for native apps,
and the only way the desktop build gets cloud sync at all (its `notes://app`
origin is not a redirect URI any provider will register). The whole main
process is still one file, with no preload, no IPC, and no storage the renderer
can see: the loopback capability is reached through the `notes://` protocol
handler that already exists, from
[`src/platform/desktop-bridge.ts`](src/platform/desktop-bridge.ts). Keep it
that way — the shell holds the socket, and every decision about what to do with
what arrives on it stays in `src/`.

So when a feature request arrives while you are working in a wrapper:

- **Build it in `src/`** and let both wrappers pick it up for free. A feature
  written in the shell exists on one platform, is barely verified (both
  wrappers are outside `make lint` / `make test`; `electron/` gets a
  types-only check from the `electron` CI job and neither has any tests), and
  has to be written again for the other shell and for the web.
- **If it genuinely cannot be done in a web page**, add the *smallest possible*
  capability to the wrapper, expose it through the platform seam, and put the
  decision of when to use it in `src/` — the wrapper answers a question, it
  does not decide anything.
- **Wanting to add a second file to `electron/`** is the signal to stop and
  re-ask whether the PWA can do it. Usually it can.

### Shared namespaces: settings widths and the two locks

A namespace can be shared by **several people through one login** — the "we all
sign into the same Dropbox" arrangement. That single fact drives three
otherwise-odd pieces of design, and a change that ignores it will quietly break
one of them:

1. **Settings have a width.** The appearance document resolves from three
   sparse layers, narrowest winning:

   | Width       | Home                                              | Reaches                          |
   | ----------- | ------------------------------------------------- | -------------------------------- |
   | `global`    | `settings.json` at the app-folder root            | everyone on the account          |
   | `namespace` | `namespace-settings.json` in the namespace folder | everyone who uses that namespace |
   | `device`    | `localStorage` only, never uploaded               | this install                     |

   Each layer holds only the **leaves** it has an opinion about
   (`editor.wordWrap`, not `editor`), which is what lets one override sit on
   top of everything else without freezing it. The settings dialog's Save and
   Reset are split buttons that pick the width; saving a leaf clears it from
   the narrower layers so the save visibly takes effect, and a leaf that
   matches the wider resolution is dropped rather than stored. Three keys stay
   unscoped in the global layer: `transforms`, `achievements`,
   `unseenAchievements`.

   **Never add a new write path that pushes the whole appearance document to a
   backend.** That is precisely the bug the widths exist to fix.

2. **Encryption is per namespace.** Mode, passphrase, lock state, and drain
   flag are all keyed by slug in `useEncryption`. Sealing your own namespace
   must not seal the shared one, and someone else sealing the shared one must
   not lock you out of yours.

3. **A namespace can carry a PIN** — a PBKDF2 verifier on the registry entry,
   so it travels with the shared folder. It is a **soft** gate and the copy
   says so: the verifier is readable by everyone sharing the account, so
   encryption is what actually protects a namespace. Don't let new copy imply
   otherwise.

Both locks are per namespace, so both full-screen gates carry
`LockedNamespaceSwitcher`: without it, one person's lock on a shared namespace
would take the whole app down for everyone, including their own namespaces.

### Where new code goes

| Adding…                                  | Put it in…                         |
| ---------------------------------------- | ---------------------------------- |
| A pure transform over the note model     | `src/domain/note.ts`               |
| A new persistence backend                | `src/storage/<backend>/index.ts`   |
| Attachment behaviour (image / file)      | `src/domain/attachment.ts`, `src/storage/attachment-store.ts`, `src/ui/attachments/` |
| How an exported PDF looks on the page    | `src/domain/pdf-layout.ts` (never the writer) |
| A presentational component               | `src/ui/`                          |
| Top-level state / a new view             | `src/app/`                         |
| A theme token or palette change          | `src/styles/theme.css` + `theme/`  |
| PWA / service-worker behaviour           | `src/pwa/`                         |
| A native-wrapper capability (bridge)     | `src/platform/native-bridge.ts` + `native/` |
| A desktop-wrapper capability (bridge)    | `src/platform/desktop-bridge.ts` + `electron/main.js` |
| Anything a wrapper seems to need         | `src/` — see "The wrappers are thin" |
| A "can this surface do X?" check          | `src/platform/capabilities.ts` — never re-derive it at the call site |
| A new achievement / its unlock trigger   | `src/achievements/catalog.ts`      |
| A user-facing string / its translation   | `src/i18n/locales/{en,sv}/<ns>.ts` |

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
  scope, so it must keep meeting that bar: accurately identify the app and the
  verified domain it is served from (read off `window.location.hostname` at
  runtime, never written down), **fully describe what the app does**, **transparently explain every reason the app requests user data**
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
which shares the same conventions and a near-identical stack (Vite + Tailwind +
vite-plugin-pwa; checklist still renders with React where notes has moved to
Preact) and
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
| The `src/` layout or boundaries   | This file's Architecture summary, `docs/architecture.md` |
| A user-facing concept, component, or term (added, renamed, or a new word the user uses) | `docs/dictionary.md` (the term → file row) **and** `docs/overview.md` (the term's description) — both in the same PR. See "Finding your way around the code". |
| The `copy-feature` skill behaviour| `.agent/skills/copy-feature/SKILL.md` |
| A user-visible feature            | a fragment in `.changes/unreleased/`, and the `/home` showcase (`src/ui/HomePage.tsx`) |
| A user-facing feature / surface (shipped or removed) | **Add (or retire) a matching achievement** in the same PR — see "Achievements". Every feature is also an unlockable trophy. |
| What data the app reads/writes/sends, or an OAuth scope | `src/ui/HomePage.tsx` **and** `src/ui/PrivacyPage.tsx` |
| Release / deploy / changelog flow | this file's "Releases and changelog"  |
| Anything under `electron/` or `native/` | that wrapper's `README.md`, and re-read "The wrappers are thin" before adding code there |

## Achievements

The app ships an **achievements** system, ported from checklist: every
user-facing feature is also an unlockable trophy, sorted into four tiers that
mirror how far the user has grown into the app —
**Beginner → Intermediate → Pro → Expert**. The trophy button in the header
opens the guided tour of the whole catalog when it's quiet; when one or more
unlocks are unacknowledged it lights up with a badge and instead opens an
unlock-notification modal listing just the new ones (closing that clears the
queue). The whole system can be switched off in Settings → General.

It lives in two places that must stay in lockstep:

- **The catalog** — `src/achievements/catalog.ts`: each entry's `id`
  (stable, write-once), `tier`, `glyph`, unlock `trigger`, and a
  `learnMore?: boolean` flag. The display copy (`name`, `condition`, optional
  `learnMore`) lives in the `achievements` i18n namespace, keyed by id
  (`achievements.catalog.<id>.{name,condition,learnMore}`) — so a new entry
  needs both a catalog row and its strings in `locales/{en,sv}/achievements.ts`.
  Glyphs are inline SVGs in `src/achievements/glyphs.tsx` (the app stays
  dependency-free — no `lucide-react`); reuse one of `src/ui/icons.tsx`'s
  glyphs where it fits.
- **The renderer** — `src/ui/achievements/AchievementsModal.tsx` reads the
  catalog by `id`. New entries appear automatically without touching it.

A trigger is either **`derived`** — a predicate over `(prev, next)` of the
combined `{ snapshot, appearance }` state that flips false→true (use this
whenever the feature mutates the persisted note document or the synced
appearance store) — or **`manual`**, fired by calling `unlock("<id>")` from
the chokepoint that observes the gesture (folder/cloud connect, encryption,
namespace create, install, undo, reload, conflict resolve). The watcher
(`src/achievements/useAchievementWatcher.ts`, mounted once in `App`) runs the
derived pass on every transition and drains the manual-unlock bus
(`src/achievements/bus.ts`). **Every `manual` entry must have a wired
`unlock("<id>")` call.** Progress lives in the synced appearance store's
`achievements` map (`src/theme/useTheme.ts`), so it travels with the user
across devices on the cloud/folder backends.

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
