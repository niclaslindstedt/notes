# Getting started

This guide takes you from a clean checkout to a running notes app.

## Prerequisites

- [Node.js](https://nodejs.org/) 22+ (the version is pinned in `.nvmrc`)
- npm 10+

## Install and run

```sh
git clone https://github.com/niclaslindstedt/notes.git
cd notes
npm ci
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`). The dev server
hot-reloads on save.

## Production build

```sh
npm run build      # outputs to dist/, including the service worker
npm run preview    # serves dist/ so you can test the installed-PWA behaviour
```

The service worker only registers in a production build (`npm run preview` or a
deploy), so install/offline behaviour is tested against `preview`, not `dev`.

## Trying it as an installed app

1. Run `npm run preview` and open the printed URL on your phone (same network),
   or deploy and open the live URL.
2. Use **Share → Add to Home Screen** (iOS Safari) or the install prompt
   (Android Chrome).
3. Launch the installed tile — it runs full-screen and works offline.

## Regenerating icons

The PWA icons under `public/` are generated from `public/favicon.svg`:

```sh
npm run icons
```

Commit the regenerated PNGs. See [`configuration.md`](configuration.md) for
the icon pipeline details.
