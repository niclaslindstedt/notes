# Contributing to notes

Thanks for your interest in improving `notes`! This document covers how to get
set up, the conventions the project follows, and how changes get reviewed.

## Prerequisites

- [Node.js](https://nodejs.org/) 22+ (see `.nvmrc`)
- npm 10+
- `git`
- A `GITHUB_PAT` environment variable holding a GitHub personal access
  token with the `read:packages` scope — the
  `@niclaslindstedt/oss-framework` dependency is served from the GitHub
  Packages npm registry, which requires authentication even for public
  packages (see `.npmrc`).

## Setup

```sh
git clone https://github.com/niclaslindstedt/notes.git
cd notes
export GITHUB_PAT=<token with read:packages>
npm ci
npm run dev      # http://localhost:5173
```

## Build, test, and lint

The canonical commands are wired through the `Makefile` (and mirrored as npm
scripts); CI runs these exact targets:

```sh
make build       # production build
make test        # vitest run
make lint        # eslint + tsc --noEmit, zero warnings
make fmt         # prettier --write
make fmt-check   # prettier --check (what CI checks)
```

Mobile is the primary target — check any visible change at a phone viewport
before opening a PR.

## Workflow

1. Fork the repo and create a topic branch off `main`.
2. Make your change with tests where it makes sense (the `src/domain/` layer
   is pure and cheap to test — keep it covered).
3. Run `make lint` and `make test` locally; both must pass.
4. Open a pull request against `main`.

### Branch naming

Use a short, descriptive, hyphenated branch name, optionally prefixed with the
change type: `feat/note-pinning`, `fix/editor-focus`, `docs/readme-install`.

### Commit and PR conventions

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- PRs are **squash-merged**, so the **PR title** must itself be a valid
  conventional-commit subject — it becomes the single commit on `main`.
- Breaking changes use `<type>!:` or a `BREAKING CHANGE:` footer.

## Testing expectations

New behaviour in `src/domain/` or `src/storage/` should come with vitest
coverage under `tests/`. UI changes are verified by eye at a mobile viewport;
add a jsdom test (`// @vitest-environment jsdom`) when the logic warrants it.

## Documentation expectations

Update the docs in the same PR as the code:

- Build/command changes → `README.md`, this file, and `AGENTS.md`.
- Architecture/layout changes → the Architecture summary in `AGENTS.md`.
- User-visible changes → a note under `CHANGELOG.md`'s `Unreleased` section.

## Porting features from checklist

Most features come from
[`checklist`](https://github.com/niclaslindstedt/checklist). Use the
`copy-feature` agent skill (`.agent/skills/copy-feature/`) rather than copying
by hand — it adapts the feature to the notes domain and keeps patterns
consistent.

## Code of Conduct and security

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Please report
security vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md)
— never in a public issue.

## Governance

`notes` is maintained by Niclas Lindstedt. The maintainer reviews and merges
all pull requests and has final say on direction. New maintainers may be added
by invitation once a track record of quality contributions is established. If
the project is abandoned, the PolyForm Noncommercial license permits anyone to
fork and continue it for noncommercial purposes.

## Where to ask

- **Bugs and feature requests:** open a [GitHub issue](https://github.com/niclaslindstedt/notes/issues).
- **Questions and ideas:** open a GitHub Discussion (or an issue if
  Discussions aren't enabled).
