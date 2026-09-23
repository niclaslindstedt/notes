<!-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0 -->

# Notes — the desktop app

A desktop wrapper around Notes for **Windows, macOS and Linux**. It is a thin
[Tauri](https://tauri.app) shell whose entire content is the built website, so
the app **looks and works exactly like the site** — and because the site is
bundled inside it and served from a private scheme, it works with no network at
all and is an app rather than a viewer for a web page.

**Thin is the specification, not a stage it is passing through.** The page is
never told it is in here: there is no initialization script, no injected
global, no Tauri command, and no permission on the window beyond Tauri's own
minimum. Everything Notes does — the document, the settings, the sync engine —
it does through the ordinary browser APIs it already uses in a tab. That is why
running here needed no change to the app at all, and it is the property to keep:
a feature that only exists in the desktop build is a second product.

**One capability, because a page cannot have it: signing in.** The app is
served from a private scheme, and no OAuth provider will redirect to one, so
Dropbox could never finish connecting here. The shell holds a one-shot
loopback listener instead (RFC 8252, the native-app flow): the page `fetch`es
`/__oauth/begin` on its own origin, opens the consent screen in the user's
browser (`window.open` is handed to it), and `fetch`es `/__oauth/await` for
what the provider sent back to `http://127.0.0.1:<port>/`. The shell decides
nothing about it — `src/storage/oauth-pkce.ts` checks `state` and trades the code.
`shell/src/oauth.rs` owns the paths, the three fixed ports (53682–53684, which
the Dropbox app's redirect allowlist must carry) and the replies;
`src-tauri/src/loopback.rs` holds the socket.

The window uses the **platform's own webview** (WebView2 on Windows, WKWebView
on macOS, WebKitGTK on Linux) rather than carrying a browser engine of its own,
which is what keeps the download and the idle memory small.

---

## Layout — TWO crates, and the split is the design

| Path                        | What it is                                                    |
| --------------------------- | ------------------------------------------------------------- |
| `shell/src/config.rs`       | The origin, the window's size, the navigation rule            |
| `shell/src/webroot.rs`      | What one request off the bundled site resolves to             |
| `shell/tests/`              | Its whole test suite — runs anywhere a Rust toolchain does    |
| `src-tauri/src/main.rs`     | The process: the builder, the plugins, the lifecycle          |
| `src-tauri/src/window.rs`   | The window, and pinning it to our own origin                  |
| `src-tauri/src/protocol.rs` | Answering `notes://` off the bundled `webroot/`               |
| `src-tauri/build.rs`        | `tauri_build::build()`, and nothing beside it                 |
| `src-tauri/capabilities/`   | **Tauri's own ACL** — what the window may reach               |
| `src-tauri/icons/`          | The app's mark, from `scripts/generate-icons.mjs` at the root |
| `scripts/bundle-web.mjs`    | Builds the site and copies it to `webroot/` (gitignored)      |

`shell/` holds every **decision** and depends on no GUI toolkit; `src-tauri/`
holds every **effect** and cannot be built without one. So
`cargo test -p notes-shell` runs the entire decision layer on a machine with a
Rust toolchain and nothing else installed — no WebKitGTK, no WebView2, no
Xcode. That is what makes this tree's logic coverable on an ordinary CI runner,
and a test that would need more than that is a decision sitting in the wrong
crate. The app crate has no tests of its own by design.

## How the pieces fit

**The origin is the one thing to be careful with.** The user's notes live in
IndexedDB and their settings in `localStorage`, both keyed by origin, so
`APP_SCHEME` and `APP_HOST` (`shell/src/config.rs`) are constants that must
never be tidied — renaming either orphans every document on the machine.
WebView2 maps a registered scheme onto `http://<scheme>.localhost`; WKWebView
and WebKitGTK serve it as a real `<scheme>://` URL. Both are one constant per
platform, which is the property that matters.

**Not `file://`, for the same reason.** The site is built with `base: "/"`, so
its absolute asset paths and ES-module imports need a real origin — and a
`file://` page is an opaque origin, which would leave the notes unable to
survive a launch.

**The bundled site carries no service worker.** `scripts/bundle-web.mjs` builds
it with `VITE_SHELL_BUILD=on`, which switches off the worker half of the root
`appPwa` plugin and, through `__SHELL_BUILD__`, the in-app update prompt. A
desktop build has no deployment to discover an update from — a new version
arrives as a new binary — so a worker here would precache a copy of files
already on local disk and then serve the page from _its_ copy, which is how a
shell whose binary shipped a new site goes on showing the old one. The script
fails the build if a worker is in the output anyway.

**Anything that is not ours opens in the browser.** The window has no chrome, so
an external link would otherwise replace the app with a page that has no back
button. `window::navigation_guard` is the whole of this shell's security policy
and it is one comparison.

## Developing

Needs a **Rust toolchain** ([rustup](https://rustup.rs)) plus the platform's
webview development libraries — Tauri's own
[prerequisites](https://tauri.app/start/prerequisites/) page is the current list
per platform. On Debian/Ubuntu that is `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`,
`libayatana-appindicator3-dev`, `librsvg2-dev` and `patchelf`; on macOS the
Xcode command line tools; on Windows the WebView2 runtime (already present on
Windows 11).

The root entry point builds the site into `tauri/webroot/`, compiles the shell,
and launches it:

```sh
npm run tauri     # from the repo root
make tauri        # the same thing
```

The first run compiles the Rust world and takes a few minutes; every one after
it is seconds. `make tauri-fast` skips the site build and re-copies whatever
`dist/` already holds — much quicker while iterating on the Rust, and wrong the
moment you have touched the app.

### Checking it

```sh
make tauri-test        # the decision layer — needs no GUI libraries
make tauri-lint        # clippy at zero warnings, BOTH crates (needs the libraries)
make tauri-fmt         # rustfmt in place (tauri-fmt-check verifies)
```

**Neither is on the root suite's path**: `make test` and `make lint` stop at
this tree's edge, because it has its own toolchain.
`.github/workflows/desktop-tauri.yml` runs both on every push that touches
`tauri/`, so a tree somebody forgot to check is a red PR rather than a surprise.

### Environment

Both are for developing rather than for shipping; an installed copy has nothing
to set.

| Variable        | Effect                                                               |
| --------------- | -------------------------------------------------------------------- |
| `NOTES_APP_URL` | Load a remote URL instead of the bundled site (the `/preview/` slot) |
| `NOTES_WEBROOT` | Serve the site from somewhere else without rebuilding                |

## Releasing

### The identity comes from the deployment

`src-tauri/tauri.conf.json` commits the project's own name and a development
identifier (`dev.local.notes`). What an installed copy is called and the
identifier it installs under arrive at packaging time, as the phone app's do:

| Secret             | Becomes                                     |
| ------------------ | ------------------------------------------- |
| `APP_DISPLAY_NAME` | `productName` — the app's installed name    |
| `APP_BUNDLE_ID`    | `identifier` — and where the app keeps data |

`scripts/package.mjs` merges them over the committed config with
`tauri build --config`. Unset, a local package runs under the development
identity; the release workflow passes `--require-identity` and refuses it.
**The identifier is also where the data lives** — each desktop webview keys its
storage by it — so changing it after a release strands every installed copy's
notes.

### Nothing else to do

`.github/workflows/release.yml` packages this shell on one
runner per platform for every release and attaches the installers to the
GitHub Release — a `.exe` on Windows, a `.dmg` on macOS, an `.AppImage` and a
`.deb` on Linux. The release is created as a draft and only published once all
three have uploaded, so a release page never appears with a download missing.

The version comes from the root `package.json` (`tauri.conf.json` names that
file rather than repeating the number), and the release job checks out the tag,
so what ships is exactly what was released.

```sh
make tauri-package        # this machine's installers
make tauri-package-debug  # …debug profile: minutes faster, much bigger bundles
make tauri-package ARGS="--target aarch64-apple-darwin"
make tauri-clean          # cargo clean — the target directory reaches gigabytes
```

`make tauri-package-debug` is the one to reach for when the question is "does
this still package on my machine" rather than "is this shippable": the release
profile is `lto = true` and `codegen-units = 1`, which is minutes of linking for
a build nobody is going to install.

`.github/workflows/desktop-tauri.yml` can also be dispatched to build all three
platforms without cutting a release.

**macOS is never signed with nothing** — Apple Silicon refuses to execute
unsigned arm64 code and reports it to the user as "the app is damaged", so the
default is an ad-hoc signature and the user answers one Gatekeeper prompt. Set
the `MAC_SIGN_IDENTITY` repository secret and the same job signs for real.
