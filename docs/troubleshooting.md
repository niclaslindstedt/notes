# Troubleshooting

## The app doesn't update to the latest version

A new build installs into the service worker's `waiting` state rather than
taking over immediately — this is deliberate, so a deploy can't discard an
in-progress edit. When a new build is ready you'll see a **"A new version is
ready"** toast with a **Reload** button; click it to apply. If you don't see
the toast, fully close and reopen the app, or pull-to-refresh.

The service worker only runs in a production build, so you won't see update
behaviour under `npm run dev` — test it with `npm run build && npm run preview`.

## My notes disappeared

Notes are stored in the browser's `localStorage`, scoped to the exact origin
(scheme + host + port) you used. They won't appear if you:

- open the app from a different URL, browser, or device,
- clear site data / browsing history for that origin, or
- use a private / incognito window (its storage is discarded on close).

There is no cloud copy by design — the app is local-first.

## The dev server won't start

- Confirm Node 22+ (`node --version`); the version is pinned in `.nvmrc`.
- Delete `node_modules` and reinstall: `rm -rf node_modules && npm ci`.

## Icons look wrong after editing the SVG

The committed PNGs under `public/` are generated, not hand-edited. After
changing `public/favicon.svg`, regenerate them and commit the result:

```sh
npm run icons
```

## Lint or type errors in CI but not locally

CI runs `make lint` (`eslint . && tsc --noEmit`) and `make fmt-check`
(`prettier --check .`). Run the same locally before pushing:

```sh
make lint
make fmt-check
```
