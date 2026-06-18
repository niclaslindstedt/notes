---
name: update-docs
description: "Use when files under docs/ may be stale. Discovers commits since the last docs update, maps changed source files to affected conceptual documentation, and brings docs/*.md (and docs/features/*.md) back into sync."
---

# Updating the Docs

**Governing spec sections:** §11.1 (`docs/` directory — the required conceptual docs tree), §21.5 (this skill is mandated because `docs/` is a drift-prone artifact).

The `docs/` directory contains conceptual documentation for notes. Unlike the README (overview) or the in-app copy, `docs/` explains _why_ and _how_ in depth. It goes stale whenever a user-visible behaviour, a configuration knob, a storage backend, or a supported surface changes without a matching edit. notes is a **browser PWA, not a CLI** — there are no exit codes or command flags to document; the surfaces are the appearance/theme settings, the storage backends, the namespace model, and the PWA install/update lifecycle.

The current docs surface:

- `docs/architecture.md` — the `src/` layering, the dependency direction, state/persistence, the PWA update model, build-time injection.
- `docs/configuration.md` — build-time env vars (`VITE_BASE`, the cloud credentials), the PWA manifest, the icon pipeline, the theme presets.
- `docs/getting-started.md` — prerequisites, install, dev/build/preview, installing as a PWA, regenerating icons.
- `docs/troubleshooting.md` — update toast, "my notes disappeared", dev-server, icons, lint/type errors.
- `docs/features/storage.md` — the storage backends (this device / local folder / Dropbox / Google Drive), encryption, offline & conflicts, settings travel, cloud credentials.
- `docs/features/namespaces.md` — the namespace model and where each namespace's data lives.

## Tracking mechanism

`.agent/skills/update-docs/.last-updated` contains the git commit hash from the last successful run. Empty means "never run" — fall back to the repository's initial commit.

## Discovery process

1. Read the baseline:

   ```sh
   BASELINE=$(cat .agent/skills/update-docs/.last-updated)
   ```

2. List commits since the baseline:

   ```sh
   git log --oneline "$BASELINE"..HEAD
   ```

3. List changed files:

   ```sh
   git diff --name-only "$BASELINE"..HEAD
   ```

4. Categorize using the mapping table below.

## Mapping table

| Changed files / scope                                                    | Doc(s) to update                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------ |
| `src/` layout, layering, or dependency direction                         | `docs/architecture.md`                                 |
| `src/storage/**` — a backend, the `StorageAdapter` contract, the serialize/migrate pipeline, encryption, the offline cache | `docs/features/storage.md`, and `docs/configuration.md` if a credential/env var moved |
| `src/storage/namespaces.ts` / `namespace-store.ts` (the namespace model) | `docs/features/namespaces.md`                          |
| Build-time env vars (`VITE_*`), the PWA manifest, the theme presets, the icon pipeline | `docs/configuration.md`                  |
| `src/pwa/**` — service-worker registration or the update lifecycle       | `docs/architecture.md` (PWA update model), `docs/troubleshooting.md` (the update toast) |
| `Makefile`, `package.json` scripts, `.nvmrc`, install/build/preview steps | `docs/getting-started.md`                             |
| A new user-facing failure mode or recovery step                          | `docs/troubleshooting.md`                              |
| `src/theme/**`, `src/styles/theme.css` — themes/palettes                 | `docs/configuration.md` (Theme section)                |

Extend this table every time you find a new source file that feeds the docs.

## Update checklist

- [ ] Read baseline from `.last-updated` and run `git log` / `git diff --name-only`
- [ ] Read every affected `docs/*.md` and `docs/features/*.md` file
- [ ] Walk the mapping table and update each doc in place
- [ ] Verify cross-links between docs still resolve (e.g. `getting-started.md` → `configuration.md`)
- [ ] Verify every shell example is still valid (`npm run …` / `make …`)
- [ ] Confirm a change to what data the app reads/writes/sends is reflected here **and** flagged for `src/ui/HomePage.tsx` / `src/ui/PrivacyPage.tsx` (these are the OAuth-verification surfaces; AGENTS.md owns that sync rule)
- [ ] Run `make lint` and `make test`
- [ ] Write the new baseline:

      git rev-parse HEAD > .agent/skills/update-docs/.last-updated

## Verification

1. Re-read every edited doc section against the current source of truth.
2. Follow every internal cross-link and confirm the target still exists.
3. Confirm `.last-updated` was rewritten.

## Skill self-improvement

1. **Grow the mapping table** with any new source → doc relationship you discovered.
2. **Record recurring patterns** you had to invent.
3. **Commit the skill edit** alongside the docs change so the knowledge compounds.
