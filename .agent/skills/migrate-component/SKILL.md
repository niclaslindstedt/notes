---
name: migrate-component
description: "Use whenever you are moving a subsystem out of notes and onto the shared @niclaslindstedt/oss-framework package — 'migrate the theme engine to the framework', 'consume the framework's storage module', 'replace our encryption with the shared one', 'adopt oss-framework for <X>'. Covers the GitHub Packages registry + auth setup (the GITHUB_PAT→GITHUB_TOKEN bridge, CI permissions, the cross-repo access grant), which framework docs to read first, the re-export-shim pattern that keeps the app's import paths stable, what stays app-side vs. what the framework owns, the Vitest CSS-inline gotcha, and the changeset/label decision. Reach for this instead of hand-wiring the dependency, so each migration lands in the same shape as the last."
---

# Migrating a notes subsystem onto `@niclaslindstedt/oss-framework`

Code shared between `notes` and [`checklist`](https://github.com/niclaslindstedt/checklist)
is being extracted into the
[`niclaslindstedt/oss-framework`](https://github.com/niclaslindstedt/oss-framework)
package so there is **one implementation to maintain instead of two**. Both apps
grew the same subsystems in parallel — storage backends, encryption, themes,
folders, namespaces — and used to copy changes between each other by hand (that
hand-porting is what the `copy-feature` skill still does for app-specific UI).
The framework is where the genuinely shared surface lives now.

notes has migrated its **`theme`** module — the first notes adoption. The
`.npmrc`, the `@niclaslindstedt/oss-framework` dependency, the CI registry
wiring, and the Vitest inline config are all in place from that migration;
`src/theme/themes.ts` + `src/theme/fonts.ts` are thin re-export shims and
`src/theme/useTheme.ts`'s projection is a one-line `useApplyTheme` call (the
store stays app-side). That is the **in-repo precedent** to study before
starting the next one (`src/storage/`, the encryption wrapper — still local
clones awaiting extraction); checklist's `theme` migration is the cross-app
precedent. This skill is the procedure those migrations followed; use it for
every subsequent notes migration so they all land in the same shape.

> **Goal of a migration:** the app's local module for that subsystem shrinks to
> near-zero — a re-export shim plus a thin adapter — while the framework owns the
> data and the logic. The *store* (where the user's choice persists) and the *UI*
> stay app-side. A clean migration is **invisible to users**.

## When to invoke

- "Migrate / move `<subsystem>` to the framework."
- "Consume / adopt the framework's `<module>` instead of our local copy."
- You are about to touch a subsystem that already has a framework counterpart —
  consume the framework rather than editing the local clone.

Do **not** invoke when:

- The subsystem has no framework counterpart yet and isn't being extracted —
  work in `src/` as normal.
- You only need to *bump* the already-consumed framework dependency to a newer
  version (that's a routine `npm install` + test run, not a migration).
- You're porting an app-specific UI surface from checklist — that's the
  `copy-feature` skill, not this one.

## Step 0 — Registry, auth, and env vars (read this first)

The package is published to the **GitHub Packages npm registry**, not npmjs.

- notes' **`.npmrc`** (added by the `theme` migration) points the
  `@niclaslindstedt` scope at `https://npm.pkg.github.com` and reads the token
  from `${GITHUB_TOKEN}`:

  ```
  @niclaslindstedt:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
  ```

  The token is **never committed** — only the env-var reference. It's in place
  now; a later migration reuses it.

- **Installing locally in the remote/web environment:** the auth token is in the
  **`GITHUB_PAT`** env var, *not* `GITHUB_TOKEN`. Bridge it at the call site:

  ```sh
  GITHUB_TOKEN="$GITHUB_PAT" npm install @niclaslindstedt/oss-framework@<version>
  ```

  A bare `npm install` / `npm ci` will **401** against GitHub Packages because
  `${GITHUB_TOKEN}` expands to empty. Always set it.

- **Do not rename `GITHUB_PAT` to `GITHUB_TOKEN`.** `GITHUB_TOKEN` is "busy" in
  both worlds: GitHub Actions forbids user secrets with the `GITHUB_` prefix (CI
  uses the auto-provided `secrets.GITHUB_TOKEN`), and the web environment
  reserves `GITHUB_TOKEN` for its own git/MCP auth. Keep the secret named
  `GITHUB_PAT` and bridge it into `GITHUB_TOKEN` only at the moment of install.

- **CI wiring (in place since the `theme` migration).** Every workflow job that
  runs `npm ci` / `npm install` needs **both**:

  ```yaml
  permissions:
    packages: read
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  ```

  `ci.yml` (the `build` job), `pages.yml` (the `build` job — four `npm ci`
  calls), and `release.yml` (the `release` job) were each wired this way by the
  `theme` migration. They're done; only a **new** workflow that installs needs
  the same two additions.

- **Cross-repo access caveat (maintainer action, not a code fix).** The built-in
  `GITHUB_TOKEN` can only read a package published from *another* repo once that
  package grants the consuming repo access:
  **oss-framework → Package settings → *Manage Actions access* → add
  `niclaslindstedt/notes`**. A `403`/`401` from `npm ci` in CI almost always
  means this grant is missing — surface it to the maintainer rather than churning
  the workflow files.

## Step 1 — Read the framework's per-module migration guide

Clone the framework and read the guide for the module you're migrating **before
touching any app code**:

```sh
git clone https://x-access-token:${GITHUB_PAT}@github.com/niclaslindstedt/oss-framework.git /tmp/oss-framework
```

Then read, in order:

1. **`/tmp/oss-framework/README.md`** — the public export table and which modules
   exist / are planned.
2. **`/tmp/oss-framework/src/<module>/README.md`** — the migration guide for the
   specific module (e.g. `src/theme/README.md`). Each one lists:
   - what the framework **owns** vs. what **stays app-side**,
   - the contract it expects (e.g. the theme module's CSS-variable contract),
   - a **"When your implementation only partially matches"** reconciliation
     checklist — read this carefully, a silent partial match is the main way a
     migration breaks after adoption.
3. The module's source under `/tmp/oss-framework/src/<module>/` — confirm the
   exported names and shapes you'll re-export match what the app imports today.

Then **map every consumer** of the local module in the app before editing
(`grep` the local import paths) so you know what the shim must keep exporting.
notes' modules often diverge from checklist's — e.g. the theme engine here is
built around the persisted `Appearance` store in `src/theme/useTheme.ts` (which
also carries the achievements map), not a `Settings`-typed `useTheme(settings)`
as in checklist — so confirm the notes shapes locally rather than assuming the
checklist precedent matches one-to-one.

## Step 2 — Add the dependency

```sh
GITHUB_TOKEN="$GITHUB_PAT" npm install @niclaslindstedt/oss-framework@<version> --save
```

Verify the lockfile change is **minimal** (only the new package entry, not a
full regeneration) and that the dist exports everything the app needs:

```sh
node -e "const m=require('@niclaslindstedt/oss-framework/<module>'); console.log(Object.keys(m))"
```

## Step 3 — Reduce the local module to shims

Keep the app's import paths stable so call sites don't change:

- **Data / pure exports** → a one-line re-export:

  ```ts
  // src/<module>/<data>.ts
  export * from "@niclaslindstedt/oss-framework/<module>";
  ```

- **A hook / engine** → a thin adapter that maps the app's types onto the
  framework's shape (so the call sites keep working unchanged). The checklist
  theme precedent (the cross-app reference — note its `useTheme` takes a
  `Settings` arg, where notes' reads from the `Appearance` store, so adapt the
  mapping to the notes shape):

  ```ts
  // src/theme/useTheme.ts
  import { useApplyTheme } from "@niclaslindstedt/oss-framework/theme";
  import type { Settings } from "../settings/types.ts";
  export function useTheme(settings: Settings): void {
    useApplyTheme({
      theme: settings.theme,
      fontFamily: settings.fontFamily,
      fontScale: settings.fontScale,
      customTheme: settings.customTheme,
    });
  }
  ```

Delete the local data tables, value maps, and per-property effects the framework
now owns. Leave a short header comment on each shim explaining it delegates to
the framework and what stays app-side.

**notes' in-repo `theme` precedent** (study these files before the next
migration): `src/theme/fonts.ts` is the one-line `export { … } from
"@niclaslindstedt/oss-framework/theme"` shim; `src/theme/themes.ts` is a
**partial** shim — it re-exports the framework theme data **but keeps an
app-side reduced vocabulary** (notes paints 11 of the framework's 18 colour
slots, so it declares its own `COLOR_KEYS` / `COLOR_GROUPS` / `COLOR_LABELS` as
`as const satisfies readonly (keyof CustomThemeColors)[]` — a typed subset —
rather than re-exporting the framework's 18-slot versions, so the Custom editor
renders only the slots notes styles). `src/theme/useTheme.ts` keeps the whole
appearance **store** and replaces its four projection `useEffect`s with a single
`useApplyTheme({ theme, fontFamily, fontScale, customTheme })` call, and folds
the framework's `coerceCustomTheme` into its store validator (it upgrades a
legacy 11-slot document to 18 slots on load). The CSS-var contract mismatch
(notes' single `--radius` vs the framework's `--radius-sm/md/lg`) was reconciled
with an **alias** in `src/styles/theme.css` (`--radius: var(--radius-md, 8px)`),
the README's low-risk option — no component CSS changed.

## Step 4 — Keep these app-side (do NOT move them)

| Stays in the app | Why |
|---|---|
| The persisted **store** / settings validator | App state is fused with app-only concerns; the framework gives you the data + projection, you keep where the choice lives. In notes that's the `Appearance` store (`src/theme/useTheme.ts`, which also persists the achievements map), the namespace registry, and the file/cloud settings store. |
| The **UI** that reads the data | App-specific look, i18n, layout. Build app labels off the framework's value lists (e.g. the theme UI builds text-size labels off `FONT_SCALE_PRESETS`). |
| App **CSS tokens / rules** | The framework defines the variable *contract*; the app owns the rules that read it (`src/styles/theme.css`). |
| **Static asset imports** | e.g. the default JetBrains Mono webfont imported in `src/app/main.tsx` so it precaches for offline first paint. |

## Step 5 — Vitest CSS-inline gotcha

Vitest treats `node_modules` as external and hands their imports to Node's native
ESM loader, which **cannot load `.css`**. If the framework module dynamically
imports CSS (the theme font loaders do `import("@fontsource/*…css")`), a
consuming test throws `ERR_UNKNOWN_FILE_EXTENSION` unless the package is
**inlined** so Vite transforms it:

```ts
// vite.config.ts → test
server: { deps: { inline: ["@niclaslindstedt/oss-framework"] } }
```

The `theme` migration added this (its font loaders dynamically import
`@fontsource/*` CSS) in `vite.config.ts → test.server.deps.inline`. It covers
the whole package, so later migrations inherit it — no action needed unless it's
removed.

## Step 6 — Verify

- `npx tsc --noEmit` — clean (or `make lint`, which also runs eslint).
- `npx eslint .` — no new errors.
- `npx vitest run` (`make test`) — all tests pass **with zero unhandled errors**
  (watch for the CSS-extension rejection from Step 5; it shows as an error even
  when tests "pass").
- `npm run build` (`make build`) — succeeds, the service worker still emits, and
  any lazy chunks the framework expects are emitted.
- Walk the module guide's **partial-match checklist** — no inert UI controls, no
  unset CSS variables, no contract drift.

## Step 7 — Changeset, commit, PR

- A behaviour-preserving framework migration is **invisible to users** → label
  the PR **`no-changelog`** (don't write a changeset fragment). `.npmrc`,
  `package.json`, and `src/**` trip the `changeset` CI job; `package-lock.json`
  and `vite.config.ts` are skip-listed (see
  `scripts/release/check-changeset.mjs`), so the label is the opt-out.
- Update the affected docs in the **same PR** — at minimum the relevant
  `docs/overview.md` section, describing the framework split (data/engine shared,
  store + UI app-side), and the matching `docs/dictionary.md` row if a term
  moved. Follow `AGENTS.md`'s "Documentation sync points".
- Conventional-commit title; `refactor(<module>):` fits a behaviour-preserving
  swap. PR title becomes the squash commit on `main`.

## Skill self-improvement

After a migration:

1. If the framework's export surface, module list, or registry/auth setup
   changed, update Step 0–1 here.
2. If a new module needs a different shim shape than the `theme` precedent now
   recorded under Step 3, document it there alongside it (the `theme` migration
   is the in-repo reference; the next one may add a second pattern).
3. If you hit a new Vitest/build gotcha consuming the framework, add it to Step 5.
4. Commit the SKILL.md edit alongside the migration, and refresh `.last-updated`
   with today's date.
