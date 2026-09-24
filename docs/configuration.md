# Configuration

`notes` has no configuration file — it runs with sensible defaults out of the
box. The few knobs that exist are build-time environment variables and
generated assets.

## Build-time environment

| Variable            | Default | Purpose                                                                                 |
| ------------------- | ------- | --------------------------------------------------------------------------------------- |
| `VITE_BASE`         | `/`     | The base path the app is served from. `pages.yml` sets this per deploy slot — `/` (production), `/preview/`, or `/branch/` — so one bundle serves any of them. |
| `APP_DISPLAY_NAME`  | `Notes` | The mobile store listing's name — read **only** when `VITE_TARGET=native`, and by `native/app.config.js` for `expo.name`. The web and desktop page builds always use the project name (the desktop package's own name comes from the same variable, at packaging time). In the app it surfaces as `APP_NAME` (`src/build-env.ts`, from the `__APP_NAME__` define, and `%APP_NAME%` in `index.html`). |
| `GITHUB_RUN_NUMBER` | —       | Set by GitHub Actions; appended to the build label so you can tell which build is live. |

None are required for local development — every one has a working default.

## Deployment

`.github/workflows/pages.yml` builds up to three slots into one GitHub Pages
artifact — `/` (latest release), `/preview/` (current `main`), and an optional
`/branch/` — and `.github/workflows/release.yml` cuts a versioned release. See
`AGENTS.md` → "Releases and changelog".

The custom domain is **not** in the repository: there is no `public/CNAME`.
`pages.yml` writes `dist/CNAME` from the `PAGES_CNAME` repository secret, into
the root of the merged artifact only (GitHub Pages reads the root CNAME and
ignores per-slot copies). With the secret unset the deploy serves on the
default `*.github.io` host, which is what a fork gets with no configuration.

## Repository secrets

Everything the deployed and packaged builds need that is not in the tree. All
of it is a repository **secret** — the repo keeps no Actions variables, so
there is one place to look and a public value costs nothing by being one. The
three `native-build.yml` values also have to exist as **EAS environment
variables** on the EAS project, because EAS resolves `native/app.config.js`
again on its own builders; a `production` build with any of them missing fails
there rather than shipping under the wrong identity.

| Name                      | Kind     | Used by                                            |
| ------------------------- | -------- | -------------------------------------------------- |
| `PAGES_CNAME`             | secret   | `pages.yml` — the custom domain for the Pages deploy. |
| `APP_DISPLAY_NAME`        | secret   | `native-build.yml` — the store listing's name.       |
| `APP_BUNDLE_ID`           | secret   | `native-build.yml` — iOS bundle identifier / Android package name. |
| `EAS_PROJECT_ID`          | secret   | `native-build.yml` — the Expo project to build against. |
| `VITE_DROPBOX_APP_KEY`    | secret   | Dropbox backend (public PKCE app key) — the Pages builds, and `native-build.yml`, which bakes it into the phone app's embedded bundle. |
| `VITE_DROPBOX_APP_FOLDER` | secret   | Dropbox app-folder name — same two places.           |
| `VITE_DONATE_URL`         | secret   | Optional donate row in the side menu.               |
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `MAC_SIGN_IDENTITY`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | secret | macOS signing and notarization of the desktop app — see [`tauri/README.md`](../tauri/README.md). |
| `GITHUB_PAT`              | secret   | `npm ci` against the GitHub Packages registry.      |

### Dropbox redirect URIs

Dropbox matches redirect URIs exactly, so the Dropbox app whose key is
`VITE_DROPBOX_APP_KEY` lists every one the three surfaces sign in through
(App Console → Settings → OAuth 2 → Redirect URIs):

- the website's deployed origins, without a trailing slash (the redirect flow);
- `http://127.0.0.1:53682/`, `:53683/` and `:53684/` for the desktop app (the
  loopback flow — see `tauri/shell/src/oauth.rs`);
- `se.agilator.notes://oauth` for the phone app — `<APP_BUNDLE_ID>://oauth`,
  the authentication session's return address (see
  [native/README.md](../native/README.md#signing-in-to-dropbox)).

## PWA manifest

The web app manifest is defined inline in `vite.config.ts` (the `VitePWA`
plugin's `manifest` block): name (the project name, suffixed per deploy slot),
theme color (`#0e1116`), icons, and the `id`/`scope`/`start_url` (all
derived from `VITE_BASE`). Edit it there.

## Icons

Icons are generated from `public/favicon.svg` by
[`@vite-pwa/assets-generator`](https://vite-pwa-org.netlify.app/assets-generator/),
configured in `pwa-assets.config.ts`:

```sh
npm run icons
```

This writes `public/pwa-{64,192,512}.png`, `public/maskable-icon-512x512.png`,
and `public/apple-touch-icon-180x180.png`. The config overrides the preset's
default padding so the dark background bleeds to every edge — no white frame on
the iOS tile, nothing revealed under an Android launcher mask. Commit the
regenerated PNGs; the manifest references them by name.

## Theme

The default theme is dark. The available presets (`dark`, `light`, `system`)
and their palettes live in `src/styles/theme.css` (the CSS tokens) and
`src/theme/useTheme.ts` (the engine that writes `data-theme`). The user's
choice is persisted to `localStorage` under `notes/theme`.
