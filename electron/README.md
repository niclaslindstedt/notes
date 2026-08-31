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

The shell owns exactly two things, both of them things a web page cannot do
for itself.

**The window's remembered size and position**, because a web page cannot size
or place its own OS window — there is nowhere in `../src/` to put it. Saved to
`window-state.json` in the app's user-data directory on close, and read back
defensively: a rectangle that no longer overlaps any connected display keeps
its size but loses its position (otherwise unplugging a monitor leaves a window
you cannot reach), and an unreadable file falls through to the defaults.

**A loopback listener for one OAuth redirect**, because a web page cannot hold
a listening socket. The app is served from `notes://app`, which no provider
will register as a redirect URI, so cloud sign-in uses the flow RFC 8252
prescribes for native apps: the consent screen opens in the user's real browser
and the provider redirects to `http://127.0.0.1:<port>/`, where the shell is
listening. It binds `127.0.0.1` (never `0.0.0.0`), takes the first free port of
three fixed ones, closes the moment a redirect arrives, and times out after
five minutes.

The shell holds the socket and nothing more: it does not know which provider is
being connected, what was asked for, or what the code is worth. Building the
authorization URL, checking `state`, and trading the code for tokens all happen
in [`../src/storage/oauth-pkce.ts`](../src/storage/oauth-pkce.ts). And it still
needs no preload and no IPC — the page reaches the capability by `fetch`ing two
reserved paths on the `notes://` scheme the protocol handler already serves
(`__oauth/begin`, `__oauth/await`), with
[`../src/platform/desktop-bridge.ts`](../src/platform/desktop-bridge.ts) owning
them on the other side.

**Anything that looks like a feature belongs in `../src/`, not here.** If a
change would add logic to this directory, that is the signal it should be
solved in the PWA instead — see AGENTS.md, "The wrappers are thin — put the
logic in the PWA".

## Why it isn't TypeScript

Compiling one file would mean a `dist/`, a build to run before both `electron
.` and packaging, and a `main` field pointing at generated output — so the
file that runs would stop being the file you read. Instead `main.js` carries
`// @ts-check` and [`jsconfig.json`](jsconfig.json) type-checks it against
Electron's own `electron.d.ts` (which ships in the npm package) with **no
emit and no build step**. `npm run typecheck` covers `main.js`, the packaging
config, and the bundle script; the `electron` job in `.github/workflows/ci.yml`
runs it on every push, since the root `make lint` / `make test` stop at this
directory's edge.

That check is types only. There are no tests here — the shell is verified by
running and packaging it.

## Build and run

```sh
npm ci                # from this directory — electron/ has its own dep tree
npm run typecheck     # type-check main.js and the build scripts (no build step)
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

The app icon is not authored here. `electron-builder.config.cjs` points at
`public/maskable-icon-1024x1024.png`, one of the PNGs `make icons` generates
from `public/favicon.svg` at the repo root, and electron-builder converts it
into each platform's format. It is the **maskable** variant on purpose: that
one is opaque edge-to-edge, and the macOS 26 Dock masks every app icon into
the system squircle — artwork carrying a transparent margin is read as a
legacy icon and gets inset onto a light backdrop instead of filling the
shape. Restyle the icon in `favicon.svg` and rerun `make icons`; there is
nothing to change in this directory. See
[`.agent/skills/tune-pwa-icons/SKILL.md`](../.agent/skills/tune-pwa-icons/SKILL.md).

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

- **Google Drive is not offered here.** It signs in through Google Identity
  Services' popup rather than the shared PKCE helpers, and moving it to the
  loopback flow needs a Google OAuth client of the **Desktop app** type — a
  separate registration from the web client the app's key belongs to. Dropbox,
  local storage and the picked-folder backend all work as they do on the web;
  use the browser build for Drive.
  That decision is made in the web app, not in this shell — see
  `../src/platform/capabilities.ts`, which resolves the surface to `desktop`
  from the `notes:` scheme, and `dropboxAvailable` / `gdriveAvailable` in
  `../src/storage/useStorageBackend.ts`.

- **Dropbox sign-in needs the loopback URIs on the app registration.** The
  three ports the shell may bind (`LOOPBACK_PORTS` in `main.js`) each have to
  appear on the Dropbox app's redirect-URI allowlist as
  `http://127.0.0.1:53682/`, `:53683/`, `:53684/` — Dropbox matches them
  exactly, trailing slash included. A missing one fails at the consent screen
  with "invalid redirect_uri" rather than later, so it is easy to spot.
