# notes

[![ci](https://github.com/niclaslindstedt/notes/actions/workflows/ci.yml/badge.svg)](https://github.com/niclaslindstedt/notes/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-PolyForm--Noncommercial--1.0.0-blue.svg)](LICENSE)

A Vite + Preact + Tailwind progressive web app, with a React Native (Expo)
WebView wrapper under [`native/`](native/README.md) and an Electron wrapper
under [`electron/`](electron/README.md) that both embed the compiled bundle.

This README covers working on the code. For how the pieces fit together, read
[`docs/architecture.md`](docs/architecture.md); for what the words in the
codebase mean, [`docs/dictionary.md`](docs/dictionary.md) and
[`docs/overview.md`](docs/overview.md).

## Prerequisites

- [Node.js](https://nodejs.org/) 22+ (see `.nvmrc`)
- npm 10+
- A `GITHUB_PAT` environment variable holding a GitHub personal access
  token with the `read:packages` scope. The app depends on
  [`@niclaslindstedt/oss-framework`](https://github.com/niclaslindstedt/oss-framework),
  which is published to the GitHub Packages npm registry; `.npmrc`
  authenticates the `@niclaslindstedt` scope through that variable
  (GitHub Packages requires a token even for public packages).

## Install

```sh
git clone https://github.com/niclaslindstedt/notes.git
cd notes
export GITHUB_PAT=<token with read:packages>
npm ci
```

## Run

```sh
npm run dev        # dev server with hot reload; open the URL it prints
npm run dev:seed   # same, seeded with sample data (see AGENTS.md)
```

Mobile is the primary target — check every visible change at a phone viewport
first (devtools device toolbar, or open the dev server's network URL on a
phone on the same network).

## Build

```sh
npm run build      # production build → dist/ (including the service worker)
npm run preview    # serve dist/ locally
```

The service worker only registers in a production build, so install and
offline behaviour is exercised against `preview`, never `dev`.

The two wrappers embed a build of their own:

```sh
make build-native    # → native/web/, then see native/README.md
make build-electron  # → electron/webroot/, then see electron/README.md
```

## Quality gates

These are the same checks CI runs; all four must pass before a PR merges.

```sh
npm run test       # vitest
npm run lint       # eslint + tsc --noEmit, zero warnings
npm run fmt        # prettier --write
npm run fmt:check  # prettier --check (the CI gate)
```

`make` targets exist for each of the above (`make test`, `make lint`,
`make fmt`, `make fmt-check`) — see the [`Makefile`](Makefile) for the full
list, including `make icons` (regenerate the PWA icon set) and `make bump` /
`make changelog` (release tooling).

## Layout

| Path         | What lives there                                              |
| ------------ | ------------------------------------------------------------- |
| `src/domain` | Pure functions over the note model. No DOM, no I/O.           |
| `src/storage`| Persistence adapters and the serialize/migrate pipeline.      |
| `src/ui`     | Presentational components.                                    |
| `src/app`    | Root component, entry point, top-level state.                 |
| `src/theme`  | Theme engine; `src/styles` holds the CSS token system.        |
| `tests/`     | Vitest suites, `*.test.ts(x)`, mirroring the `src/` concerns.  |
| `native/`    | Expo WebView wrapper (thin — see its README).                 |
| `electron/`  | Electron desktop wrapper (thin — see its README).             |
| `notesd/`    | Optional self-hosted sync daemon.                             |

Dependency direction is `app → ui → domain` and `app → storage → domain`;
eslint enforces that nothing in `domain/` reaches for the DOM or the layers
above it.

## Configuration

Nothing is required to run locally. Every knob is a build-time environment
variable — see [`docs/configuration.md`](docs/configuration.md) and
[`.env.example`](.env.example).

## Contributing

Read [`AGENTS.md`](AGENTS.md) first: it is the canonical guide to the
conventions in this repo (commit format, changeset fragments, the docs that
must move in lockstep with a change). Then
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the workflow, the
[Code of Conduct](CODE_OF_CONDUCT.md), and [`SECURITY.md`](SECURITY.md) for
reporting a vulnerability.

## Documentation

- [Getting started](docs/getting-started.md)
- [Configuration](docs/configuration.md)
- [Architecture](docs/architecture.md)
- [Troubleshooting](docs/troubleshooting.md)
- [`AGENTS.md`](AGENTS.md) — guidance for AI coding agents
- [`OSS_SPEC.md`](OSS_SPEC.md) — the spec this repo follows

## License

[PolyForm Noncommercial 1.0.0](LICENSE) © Niclas Lindstedt
