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
conformance incrementally — the release pipeline (`version-bump.yml`,
`release.yml`), the marketing `website/`, and the full SEO scaffolding are not
in place yet. Run the validator to see the current gap:

```sh
bash /path/to/oss-spec/scripts/validate.sh .
```

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

## Architecture summary

The source tree under `src/` is organized by concern, not by file type:

- `src/app/` — the root component (`App.tsx`), the entry point
  (`main.tsx`), and top-level state hooks (`use-notes.ts`).
- `src/domain/` — pure functions over the note model (`note.ts`). No DOM,
  no I/O, trivially testable. The boundary is enforced by eslint.
- `src/storage/` — persistence. `local.ts` (localStorage) is the only
  backend today; it is the seam a synced backend grows behind.
- `src/theme/` — the theme engine (`useTheme.ts`): projects the chosen
  preset onto `<html data-theme>`, which the CSS tokens key off.
- `src/styles/` — the CSS-variable token system (`theme.css`).
- `src/pwa/` — service-worker registration and update lifecycle
  (`usePwaUpdate.ts`), standalone/install detection (`standalone.ts`).
- `src/ui/` — presentational components (e.g. `UpdateToast.tsx`).

Dependency direction: `app → ui → domain`, `app → storage → domain`.
Nothing in `domain/` may import from `ui/`, `storage/`, `app/`, or touch
the DOM. This keeps `domain/` portable to the planned React Native app.

### Where new code goes

| Adding…                                  | Put it in…                         |
| ---------------------------------------- | ---------------------------------- |
| A pure transform over the note model     | `src/domain/note.ts`               |
| A new persistence backend                | `src/storage/<backend>.ts`         |
| A presentational component               | `src/ui/`                          |
| Top-level state / a new view             | `src/app/`                         |
| A theme token or palette change          | `src/styles/theme.css` + `theme/`  |
| PWA / service-worker behaviour           | `src/pwa/`                         |

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
| A user-visible feature            | `CHANGELOG.md` (Unreleased)           |

## Maintenance skills

Agent skills live under `.agent/skills/` (with `.claude/skills` symlinked to
it). Each has a `SKILL.md` and a `.last-updated` marker.

- `copy-feature` — clone checklist, explore a named feature, and port it into
  this app adapted to the notes domain.
