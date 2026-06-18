# notes

> A local-first PWA for taking notes that works great on mobile and desktop.

[![ci](https://github.com/niclaslindstedt/notes/actions/workflows/ci.yml/badge.svg)](https://github.com/niclaslindstedt/notes/actions/workflows/ci.yml)
[![pages](https://github.com/niclaslindstedt/notes/actions/workflows/pages.yml/badge.svg)](https://github.com/niclaslindstedt/notes/actions/workflows/pages.yml)
[![release](https://github.com/niclaslindstedt/notes/actions/workflows/release.yml/badge.svg)](https://github.com/niclaslindstedt/notes/actions/workflows/release.yml)
[![license](https://img.shields.io/badge/license-PolyForm--Noncommercial--1.0.0-blue.svg)](LICENSE)

Try it: **<https://notes.niclaslindstedt.se>**

## What

`notes` is a tiny, fast note-taking app that lives in your browser. It's a
Progressive Web App: install it to your phone's home screen and it runs
full-screen, offline, and feels native. Your notes are stored locally on your
device — there is no account and no backend.

It's built on the same stack and conventions as
[`checklist`](https://github.com/niclaslindstedt/checklist), and most of its
richer features (modals, settings, themes, sync) will be ported across over
time using the `copy-feature` agent skill.

## Why

- **Local-first.** Notes are saved to the browser, instantly, with no network
  round-trip and no sign-in. It works on a plane.
- **Installable.** Add it to your home screen and it behaves like a native
  app — its own icon, full-screen, offline-capable.
- **Mobile-first.** The primary testing device is a phone; the desktop layout
  is the same UI given more room.
- **Cross-platform by design.** The note model is framework-free, so a planned
  React Native app can reuse it unchanged.

## Prerequisites

- [Node.js](https://nodejs.org/) 22+ (see `.nvmrc`)
- npm 10+

## Install

```sh
git clone https://github.com/niclaslindstedt/notes.git
cd notes
npm ci
```

## Quick start

```sh
npm run dev      # start the dev server, then open the printed URL
```

To build and preview the production PWA (with the service worker):

```sh
npm run build
npm run preview
```

### Install on your phone

Open the deployed app (or your `preview` URL) in mobile Safari or Chrome, then
use **Share → Add to Home Screen**. The app installs with its own icon and
launches full-screen and offline-capable.

## Usage

- Tap the **+** button to start a new note.
- The first line becomes the note's title in the list.
- Notes auto-save as you type; the list shows the most recently edited first.
- Use the theme toggle in the header to switch Dark / Light / System.
- **Delete** removes a note from the editor; an abandoned blank note discards
  itself.

## Configuration

There is no configuration file — the app runs with sensible defaults. The
GitHub Pages base path is injected at build time via the `VITE_BASE`
environment variable so the same bundle works at `/` or any subpath. See
[`docs/configuration.md`](docs/configuration.md).

## Examples

The repository itself is the example: clone it, run `npm run dev`, and you have
a working note app. The `src/domain/note.ts` module is a self-contained,
dependency-free model you can read top to bottom in a minute.

## Troubleshooting

- **The PWA doesn't update.** A new build parks in the service worker's
  `waiting` state and prompts you to reload — click **Reload** in the toast.
  See [`docs/troubleshooting.md`](docs/troubleshooting.md).
- **Notes disappeared.** They live in this browser's `localStorage` for this
  origin. A different browser, cleared site data, or private mode won't see
  them.

## Documentation

- [Getting started](docs/getting-started.md)
- [Configuration](docs/configuration.md)
- [Architecture](docs/architecture.md)
- [Troubleshooting](docs/troubleshooting.md)
- [`AGENTS.md`](AGENTS.md) — guidance for AI coding agents
- [`OSS_SPEC.md`](OSS_SPEC.md) — the spec this repo follows

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). By participating you agree to the
[Code of Conduct](CODE_OF_CONDUCT.md); report security issues per
[`SECURITY.md`](SECURITY.md).

## License

[PolyForm Noncommercial 1.0.0](LICENSE) © Niclas Lindstedt
