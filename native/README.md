# notes — native app (thin WebView wrapper)

A **thin** React Native (Expo) shell around the **notes** web PWA. It embeds a
compiled copy of the web app and loads it offline from local files inside a
single full-screen WebView. Everything the user sees is the web app; the
wrapper exists only to add the two capabilities a WebView can't provide.

[`RELEASING.md`](RELEASING.md) is the step-by-step for building and submitting
to the App Store and Google Play via EAS; [`APP_STORE.md`](APP_STORE.md) is the
source material for the store listings — what the app offers over the website
(the reasons to install) plus draft copy.

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

Everything else — the UI, storage (`localStorage`), Markdown editor, themes,
cloud backends, achievements — is the web app, unchanged. There is **no**
duplicated presentation layer and **no** native storage backend anymore.

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
  the message bridge.

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

> **Status:** the pinned-fetch native module can only be exercised
> end-to-end once the web-side notesd adapter and a running daemon exist. The
> web seam is unit-tested (`tests/platform/native-bridge.test.ts`); the native
> module is validated manually against a known-good / known-bad pin.

## Running it

Because the app embeds native modules (WebView + pinning), it needs a **dev
client / prebuild** — it does not run in Expo Go.

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
