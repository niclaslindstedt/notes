# notes — desktop app (thin Electron wrapper)

A **thin** Electron shell around the **notes** web PWA. It bundles a compiled
copy of the web app and shows it in one window, loaded offline from local
files. Everything the user sees is the web app.

## Why it's thin

The whole main process is [`main.js`](main.js) — most of it comments. There is
**no** preload, **no** IPC, **no** storage the renderer can see, and no UI of
the shell's own. The desktop build has nothing the browser build lacks; it
exists so the app can be downloaded, launched from the dock or Start menu, and
kept out of a browser tab.

The one thing the shell does own is the **window's remembered size and
position**, because a web page cannot size or place its own OS window — there
is nowhere in `../src/` to put it. Saved to `window-state.json` in the app's
user-data directory on close, and read back defensively: a rectangle that no
longer overlaps any connected display keeps its size but loses its position
(otherwise unplugging a monitor leaves a window you cannot reach), and an
unreadable file falls through to the defaults.

**Anything that looks like a feature belongs in `../src/`, not here.** If a
change would add logic to this directory, that is the signal it should be
solved in the PWA instead — see AGENTS.md, "The wrappers are thin — put the
logic in the PWA".

## Build and run

```sh
npm ci                # from this directory — electron/ has its own dep tree
npm run bundle        # build the web app into electron/webroot/
npm start             # bundle, then launch the shell
npm run dist          # bundle + package (Linux tar.gz)
npm run dist:win      # …Windows zip
npm run dist:mac      # …macOS zip, Intel and Apple Silicon
```

`make build-electron` from the repo root runs the bundle step alone.

Packaging must happen on the target OS — each run packages that platform's
Electron binary — which is why the release workflow uses one runner per
platform. `npm run dist:mac` builds **both** macOS slices as separate
archives.

## How it's put together

- [`scripts/bundle-web.mjs`](scripts/bundle-web.mjs) builds the web app with
  `VITE_TARGET=electron`, which gives it a relative asset base and no service
  worker (offline is already guaranteed by the local bundle; updates ride app
  releases). Output goes to `webroot/`, which is git-ignored.
- [`main.js`](main.js) registers the private `notes://app` scheme and serves
  `webroot/` from it. Not `file://`: notes live in `localStorage`, which is
  keyed by origin, and a `file://` page is an opaque origin — the registered
  scheme is a constant, so notes survive updates and moves.
- [`electron-builder.config.cjs`](electron-builder.config.cjs) packages an
  **archive** per platform rather than an installer, and reads the app version
  from the root `package.json`.

## macOS signing

The build always signs, because an unsigned arm64 app cannot run at all —
macOS reports the refusal as *"Notes.app is damaged"*. With no credentials it
signs **ad hoc**, which runs natively but still meets Gatekeeper's
unidentified-developer prompt once (System Settings › Privacy & Security ›
Open Anyway). Set the `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` repository
secrets — plus `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`
to notarize — and the same job signs for real and the prompt goes away.

## Known limitations

- **The cloud backends (Dropbox, Google Drive) are not offered here.** Their
  OAuth flows redirect back to a registered `https://` URL, which the
  `notes://app` origin is not, so the storage picker shows both rows disabled.
  That decision is made in the web app, not in this shell — see
  `../src/platform/capabilities.ts`, which resolves the surface to `desktop`
  from the `notes:` scheme. Local storage and the picked-folder backend work
  as they do on the web; use
  [notes.niclaslindstedt.se](https://notes.niclaslindstedt.se) for cloud sync.
