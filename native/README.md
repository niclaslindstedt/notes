# notes — native app (thin WebView wrapper)

A **thin** React Native (Expo) shell around the **notes** web PWA. It packs a
compiled copy of the web app into the binary and serves it, offline, from a
loopback server on the device — `http://localhost:8311` — to a single
full-screen WebView. Everything the user sees is the web app; the
wrapper exists only to add the capabilities a WebView can't provide.

[`RELEASING.md`](RELEASING.md) is the step-by-step for building and submitting
to the App Store and Google Play via EAS. The store listings themselves — the
name, the description, the screenshots — are maintained in App Store Connect
and the Play Console, not in this repository.

## Why a wrapper (and why it's thin)

The web app is a local-first PWA that already runs great on mobile. Shipping it
through the stores as a native binary buys four things the browser/WebView
can't do on its own:

1. **Haptics** — iOS WKWebView ignores `navigator.vibrate` entirely.
2. **iCloud Drive** (iOS) — a web page has no way to write into the user's
   iCloud Drive. The wrapper offers a small file store (list, read, write,
   remove) inside the app's own container, `iCloud.se.agilator.notes`, and the
   web app's directory adapter drives it like any other folder.
3. **Dropbox sign-in** — a provider will neither show its consent page inside
   an embedded WebView nor redirect back into one. The wrapper offers an
   authentication session instead (see
   [Signing in to Dropbox](#signing-in-to-dropbox)).
4. **Exports** — a download goes nowhere in a WebView. The wrapper hands an
   exported note (`.md`, PDF) or a file attachment to the share sheet instead
   (see [Exports](#exports)).

Everything else — the UI, storage (`localStorage`), Markdown editor, themes,
cloud backends, encryption — is the web app, unchanged, except that the phone
build leaves out what the website alone carries (the Donate row, the
achievements, and any link back to the source: `scripts/bundle-web.mjs`
refuses a webroot that spells `niclaslindstedt` anywhere). There is
**no** duplicated presentation layer, and the iCloud store decides nothing: it
moves the bytes the web app hands it, which are already sealed when encryption
is on.

## How it's built and loaded

```
make native-bundle         # from the repo root: build:native → native/web/ → native/assets/webroot.zip
```

- [`scripts/bundle-web.mjs`](scripts/bundle-web.mjs) runs `make build-native`'s
  build (`VITE_TARGET=native`: a **relative asset base**, the **service worker
  disabled**, no Donate link, one chunk — offline is already guaranteed by the
  local bundle and app updates ride store releases) into `native/web/`, then
  packs it into **`assets/webroot.zip`** (deterministic, git-ignored). Metro
  ships the zip as an asset ([`metro.config.js`](metro.config.js)).
- [`src/local-server.ts`](src/local-server.ts) unzips it into the app's
  document directory on the first launch of each build and serves it with
  lighttpd (`@dr.pogodin/react-native-static-server`) on the loopback
  interface only, at **`http://localhost:8311`** — notes' own port on the
  fleet's ladder (8312, 8313 if it is taken). The port never moves: the origin
  is what `localStorage`, and so every note on the device, is keyed by. It is
  `localhost`, not `127.0.0.1`, because App Transport Security blocks the
  latter from WKWebView; [`app.config.js`](app.config.js) excepts `localhost`
  from ATS, and `expo-build-properties` permits cleartext and raises Android's
  minSdk to 28 for the server.
- [`src/WebViewHost.tsx`](src/WebViewHost.tsx) starts the server (a spinner
  meanwhile, a failure screen with **Try again** if it cannot bind), renders
  the WebView and wires the message bridge. Before the page's scripts run it
  unregisters any service worker ([`src/shell.ts`](src/shell.ts)), so a
  worker could never keep serving an old build after a store update. Any
  navigation off the loopback origin opens in the system browser, except a
  `blob:` or `data:` URL, which exists only in the page and is refused; Android's
  back button walks the page's history. On iOS the WebView runs edge to edge and the page pads
  itself around the notch and the home indicator with
  `env(safe-area-inset-*)`, as the installed PWA does; on Android the frame
  keeps the page below the status bar and clear of any cutout. The status bar
  and the background behind the WebView follow the page's own theme, which
  [`src/nativeTheme.ts`](src/nativeTheme.ts) reads off `--page-bg` and
  reports over the same `postMessage` transport.

## The web ↔ native bridge

The web side lives in [`../src/platform/native-bridge.ts`](../src/platform/native-bridge.ts);
the native side is [`src/bridge/on-message.ts`](src/bridge/on-message.ts).
There is one message, JSON, and nothing comes back:

```
web → native  (window.ReactNativeWebView.postMessage(JSON.stringify(msg))):
  { v: 1, type: "haptics.vibrate", pattern }
```

- **Haptics** → `expo-haptics` (iOS light impact) / `Vibration` (Android,
  honors the pattern). The web app calls `haptics.vibrate()`, which falls
  back to `navigator.vibrate` outside the wrapper.

## iCloud Drive — a capability, not a message

iCloud rides beside the bridge above rather than inside it. The web app never
asks whether it is in the wrapper; it looks for an **iCloud provider** on
`window` ([`../src/platform/icloud-host.ts`](../src/platform/icloud-host.ts))
and offers the backend only when one is there. The wrapper installs it:

- [`src/icloudBridge.ts`](src/icloudBridge.ts) — `ICLOUD_SCRIPT`, injected
  before the page loads (`injectedJavaScriptBeforeContentLoaded`), defines
  `window.__notesICloud` (`version: 1`, `status`, `list`, `read`, `write`,
  `readBytes`, `writeBytes`, `remove`) and fires `notes:icloud-host`. Each call
  posts `{ type: "notes-native/icloud-request", id, method, args }`; the answer
  comes back through `resolveScript`, as a JSON string parsed in the page so no
  note text can break out of the script.
- [`src/icloud.ts`](src/icloud.ts) — answers a request from the native module,
  turning every failure into `{ ok: false, error }`, caching and logging
  nothing.
- [`modules/icloud-store`](modules/icloud-store) — the Swift file store in the
  container's `Documents` folder: coordinated reads (which download a file not
  yet on the device), atomic writes, `.icloud` placeholders listed under their
  real names. iOS only; on Android the module is absent, the status is
  `unavailable`, and the web app hides the option.
- [`app.config.js`](app.config.js) — the iCloud entitlements and the
  `NSUbiquitousContainers` declaration that shows the folder in the Files app
  as "Notes". The container is a committed literal, never derived from the
  bundle id; see [`RELEASING.md`](RELEASING.md) for registering it.

The contract — property, event, method list, script safety, and the container
spelled the same in every place — is pinned from the root suite by
`tests/native_icloud_test.ts`.

## Signing in to Dropbox

The web app signs in to Dropbox with a PKCE redirect: it sends the page to
Dropbox and Dropbox sends it back to the page's own URL. Inside the app that
cannot work — the providers refuse to show consent inside an embedded WebView,
and a redirect completed in the system browser lands there, not in the app. So the wrapper
offers an **authentication session** — `ASWebAuthenticationSession` on iOS, a
Custom Tab on Android, both through `expo-web-browser`'s
`openAuthSessionAsync` — a browser sheet over the app that closes the moment
Dropbox redirects to a URI the app claims, and hands that URI back.

- [`src/authSessionBridge.ts`](src/authSessionBridge.ts) — the script,
  injected before the page loads beside the iCloud one, that defines
  `window.__ossAuthSession` (`version: 1`, `redirectUri`, `open(url)`) and
  fires `oss:auth-session-host`. Those are the framework's names
  (`getAuthSessionHost` in `@niclaslindstedt/oss-framework/storage`), because
  the page-side flow is the framework's `runAuthSessionAuth`. `open` posts
  `{ type: "notes-native/auth-session-request", id, url }`; only an `https:`
  URL is honoured.
- [`src/authSession.ts`](src/authSession.ts) — opens the sheet and reports
  where it ended: the redirect URL, unread, or `null` when the reader closed
  it.

The wrapper never sees a token. The page generates the PKCE verifier, checks
that the sheet ended on the redirect URI and carried the `state` it sent, and
makes the token exchange itself; a closed sheet is a quiet cancel, and the
verifier is dropped on any failure. The page offers Dropbox here because the
provider is present (`capabilities().authSessionOauth`), not because it knows
it is in the app.

**The redirect URI is `<bundle id>://oauth`.** The Expo `scheme` in
[`app.config.js`](app.config.js) is the bundle id — `APP_BUNDLE_ID`, falling
back to `dev.local.notes` — so the store build returns on
**`se.agilator.notes://oauth`**, and the Dropbox app must list exactly that
(see [`RELEASING.md`](RELEASING.md#dropbox)). A dev build returns on
`dev.local.notes://oauth`, which a Dropbox app used for development has to
list too. The key reaches the bundle as `VITE_DROPBOX_APP_KEY` at
`make native-bundle` time; without it the app offers no Dropbox at all.

`tests/native_auth_session_test.ts` runs the injected script against the
framework's own validation and pins the scheme to the bundle id.

## Exports

A browser export is a download: an anchor clicked at a `blob:` or `data:` URL.
In the WebView that goes nowhere. So the wrapper implements the framework's
**`save-file`** contract (`docs/native-shell.md` in oss-framework), and every
export in the page — the note as `.md` or PDF (`src/ui/export/export-note.ts`)
and a file attachment's chip (`src/ui/attachments/FileAttachment.tsx`) — goes
through the framework's `saveFile`:

```
saveFile({ text | blob, filename, mimeType })       (oss-framework)
   │  window.__ossShell.capabilities has "save-file" — set before the page
   │  loads by SAVE_FILE_DESCRIPTOR (src/saveFileBridge.ts)
   ▼
postMessage { type: "oss-framework/save-file", id, filename, mimeType, base64 }
   ▼
WebViewHost.tsx → src/saveFile.ts → cache/exports/<id>/<name> → Sharing.shareAsync
   │  the user saves to Files, mails it, AirDrops it — or closes the sheet
   ▼
injectJavaScript: "oss-framework/save-file-result" { id, ok }
```

Without the descriptor the page keeps downloading, so the website and the
desktop app behave as they always did. `src/saveFileBridge.ts` is import-free
and pinned from the root suite (`tests/native_save_file_test.ts`, a whole
round trip against a stand-in page); `src/saveFile.ts` is the
`expo-file-system` / `expo-sharing` half. Only the latest export stays on
disk, in the cache the next export clears, and the bytes are never logged.

It has not been tried on a device yet.

## Nextcloud from the phone

The page's origin in the app is `http://localhost:8311`, a real origin rather
than the `null` one a `file://` page had. Nextcloud is reached with the page's
own `fetch`, so it is a cross-origin request like the website's: the server
has to answer the
  preflight for WebDAV (`GET`, `PROPFIND`, `MKCOL`, `PUT`, `DELETE`, with the
  `Authorization`, `Depth` and `Content-Type` headers). The origin to allow is now exactly
  **`http://localhost:8311`** — no longer `null`, which a server had to allow
  for every `file://` page and sandboxed frame at once. Expose `ETag` too, or
  the app re-lists after each save instead of reading the new revision off
  the response. The connect form's check (`verifyNextcloudConnection`)
  explains a refusal. Use HTTPS: App Transport Security stays on, with the
  exception for `localhost` and the `NSAllowsLocalNetworking` every wrapper in
  the fleet declares.

It has not been tried end to end on a device since the move from `file://`.

## Running it

Because the app embeds native modules (WebView + static server + iCloud), it
needs a **dev client / prebuild** — it does not run in Expo Go.

```sh
make native-install    # from the repo root: npm ci in native/
make native-bundle     # build the web app and pack native/assets/webroot.zip
cd native
npx expo run:ios       # or: npx expo run:android (npm run ios / android bundle first)
```

Check the native shell:

```sh
make native-typecheck
make native-doctor     # expo-doctor (CI runs it too)
```
