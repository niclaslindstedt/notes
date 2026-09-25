# notes — native app (thin WebView wrapper)

A **thin** React Native (Expo) shell around the **notes** web PWA. It embeds a
compiled copy of the web app and loads it offline from local files inside a
single full-screen WebView. Everything the user sees is the web app; the
wrapper exists only to add the capabilities a WebView can't provide.

[`RELEASING.md`](RELEASING.md) is the step-by-step for building and submitting
to the App Store and Google Play via EAS. The store listings themselves — the
name, the description, the screenshots — are maintained in App Store Connect
and the Play Console, not in this repository.

## Why a wrapper (and why it's thin)

The web app is a local-first PWA that already runs great on mobile. Shipping it
through the stores as a native binary buys three things the browser/WebView
can't do on its own:

1. **Haptics** — iOS WKWebView ignores `navigator.vibrate` entirely.
2. **SPKI-pinned HTTPS** — the self-hosted [`notesd`](../notesd/README.md)
   daemon serves a self-signed TLS certificate that no public CA vouches for;
   reaching it safely requires pinning its SPKI SHA-256 fingerprint, which a
   browser can't do but native code can.
3. **QR camera scan** — reading a notesd daemon's pairing QR needs reliable
   camera access, which iOS WKWebView can't grant a `file://` page.
4. **iCloud Drive** (iOS) — a web page has no way to write into the user's
   iCloud Drive. The wrapper offers a small file store (list, read, write,
   remove) inside the app's own container, `iCloud.se.agilator.notes`, and the
   web app's directory adapter drives it like any other folder.
5. **Dropbox sign-in** — the page is loaded over `file://`, which no OAuth
   provider will redirect back to. The wrapper offers an authentication
   session instead (see [Signing in to Dropbox](#signing-in-to-dropbox)).

Everything else — the UI, storage (`localStorage`), Markdown editor, themes,
cloud backends, encryption, achievements — is the web app, unchanged. There is
**no** duplicated presentation layer, and the iCloud store decides nothing: it
moves the bytes the web app hands it, which are already sealed when encryption
is on.

## How it's built and loaded

```
make build-native          # from the repo root: VITE_TARGET=native vite build → native/web/
cd native && npx expo prebuild   # copies native/web/ into the binary (see plugins/with-web-bundle.js)
```

- `make build-native` builds the web app with a **relative asset base**
  (`./assets/...`, so it resolves under a `file://` origin) and the **service
  worker disabled** (offline is already guaranteed by the local bundle; app
  updates ride store releases). Output goes to `native/web/` (git-ignored).
- The Expo config plugin [`plugins/with-web-bundle.js`](plugins/with-web-bundle.js)
  copies `native/web/` into the binary at prebuild: `assets/web/` on Android
  (loaded from `file:///android_asset/web/index.html`) and a bundle folder
  reference on iOS (loaded from `bundleDirectory/web/index.html`).
- [`src/WebViewHost.tsx`](src/WebViewHost.tsx) renders the WebView and wires
  the message bridge. On iOS the WebView runs edge to edge and the page pads
  itself around the notch and the home indicator with
  `env(safe-area-inset-*)`, as the installed PWA does; on Android the frame
  keeps the page below the status bar and clear of any cutout. The status bar
  and the background behind the WebView follow the page's own theme, which
  [`src/nativeTheme.ts`](src/nativeTheme.ts) reads off `--page-bg` and
  reports over the same `postMessage` transport.

## The web ↔ native bridge

The web side lives in [`../src/platform/native-bridge.ts`](../src/platform/native-bridge.ts);
the native side is [`src/bridge/on-message.ts`](src/bridge/on-message.ts) plus
the [`pinned-fetch`](modules/pinned-fetch) native module. Messages are JSON:

```
web → native  (window.ReactNativeWebView.postMessage(JSON.stringify(msg))):
  { v: 1, type: "haptics.vibrate", pattern }
  { v: 1, type: "pinnedFetch.request", id, url, method, headers, bodyBase64|null, spkiPin }
  { v: 1, type: "qr.scan.request", id }

native → web  (injected as window.__NOTES_NATIVE__.resolve / .resolveQr):
  resolve:   { id, ok, status, statusText, headers, bodyBase64|null, error?: { name, message } }
  resolveQr: { id, value: string|null, error?: { name, message } }
```

Bodies are base64 because both channels are string-only and notesd payloads
carry binary (encrypted) envelopes.

- **Haptics** → `expo-haptics` (iOS light impact) / `Vibration` (Android,
  honours the pattern). The web app calls `haptics.vibrate()`, which falls
  back to `navigator.vibrate` outside the wrapper.
- **Pinned fetch** → the [`pinned-fetch`](modules/pinned-fetch) local Expo
  module performs an HTTPS request whose server certificate is trusted **iff**
  its SPKI SHA-256 matches the pin, bypassing the system CA store (iOS: a
  `URLSession` trust-evaluation delegate; Android: an `HttpsURLConnection`
  with a pin-only `X509TrustManager`). The notesd `StorageAdapter` (web-side)
  consumes this via `createPinnedFetch(pin)`.
- **QR scan** → `expo-camera`'s `CameraView`. `WebViewHost` mounts the
  [`QrScanner`](src/QrScanner.tsx) overlay while a `qr.scan.request` is in
  flight and injects `resolveQr` with the decoded pairing code (or `null` when
  dismissed). The web app calls `qr.scan()`, which rejects outside the wrapper,
  and feeds the code into the existing notesd pairing path.

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
`tests/platform/icloud-host.test.ts`.

> **Status:** the pinned-fetch native module can only be exercised
> end-to-end once the web-side notesd adapter and a running daemon exist. The
> web seam is unit-tested (`tests/platform/native-bridge.test.ts`); the native
> module is validated manually against a known-good / known-bad pin.

## Signing in to Dropbox

The web app signs in to Dropbox with a PKCE redirect: it sends the page to
Dropbox and Dropbox sends it back to the page's own URL. Here that URL is
`file:///…/web/index.html` — no provider will register it, and the providers
refuse to show consent inside an embedded WebView anyway. So the wrapper
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
`make build-native` time; without it the app offers no Dropbox at all.

`tests/platform/auth-session.test.ts` runs the injected script against the
framework's own validation and pins the scheme to the bundle id.

## Running it

Because the app embeds native modules (WebView + pinning + iCloud), it needs a
**dev client / prebuild** — it does not run in Expo Go.

```sh
cd native
npm install
make build-native   # (from repo root) produce native/web/ first
npx expo prebuild
npx expo run:ios     # or: npx expo run:android
```

Type-check the native shell:

```sh
npm run typecheck
```
