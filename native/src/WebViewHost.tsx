// The entire native app: a single full-screen WebView that loads the compiled
// web PWA embedded in the binary (built by `make build-native` into
// `native/web/` and copied in at prebuild by `plugins/with-web-bundle.js`).
//
// Everything the user sees is the web app running offline from local files.
// The only things this shell adds are the capabilities a WebView can't
// provide, routed over the bridge in `bridge/on-message.ts`:
//   1. real haptics (iOS WKWebView ignores `navigator.vibrate`),
//   2. SPKI-pinned HTTPS for a self-hosted notesd daemon, and
//   3. a QR camera scan (the `QrScanner` overlay) for pairing that daemon —
// plus one the page finds rather than asks for:
//   4. an iCloud Drive file store (iOS), installed as a provider on `window`
//      by `ICLOUD_SCRIPT` and answered by `answerICloud` (`icloud*.ts`), and
//   5. an authentication session for signing in to Dropbox, installed as
//      `window.__ossAuthSession` by `authSessionScript` and answered by
//      `answerAuthSession` (`authSession*.ts`). A `file://` page has no
//      origin a provider can redirect back to; the session's sheet returns on
//      `<bundle id>://oauth` instead.
//      The page asks whether each provider is there, never where it is running.
//
// See `native/README.md` for the message protocol and the web-side seams in
// `src/platform/native-bridge.ts` and `src/platform/icloud-host.ts`.

import { useCallback, useRef, useState } from "react";
import { Platform, StyleSheet } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as FileSystem from "expo-file-system";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { handleBridgeMessage } from "./bridge/on-message";
import { answerICloud } from "./icloud";
import { ICLOUD_SCRIPT, isICloudRequest, resolveScript } from "./icloudBridge";
import { answerAuthSession, authRedirectUri } from "./authSession";
import {
  authSessionResolveScript,
  authSessionScript,
  isAuthSessionRequest,
} from "./authSessionBridge";
import QrScanner from "./QrScanner";
import { useNativeTheme } from "./nativeTheme";

// Parse a message body for the iCloud check. The other bridge parses its own;
// anything that is not JSON is simply not an iCloud request.
function parseMessage(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// The redirect URI a sign-in comes back on (`<bundle id>://oauth`), and the
// provider the page finds it through. Null in a build with no URL scheme,
// which offers no provider — the page then hides Dropbox, since its redirect
// flow cannot land on a `file://` page.
const AUTH_REDIRECT_URI = authRedirectUri();
const AUTH_SESSION_SCRIPT = AUTH_REDIRECT_URI
  ? authSessionScript(AUTH_REDIRECT_URI)
  : "";

// The chrome shown before the page reports its theme: the page's pre-boot
// default (One Dark), with light status-bar icons over it. Once the WebView
// paints, `useNativeTheme` takes over with the live theme.
const BACKGROUND = "#1d2027";

// Where the embedded bundle's entry point lives on each platform. Android
// keeps it under the APK's `assets/`; iOS under the app bundle, whose file URL
// `expo-file-system` exposes as `bundleDirectory`.
function indexUri(): string {
  if (Platform.OS === "android") {
    return "file:///android_asset/web/index.html";
  }
  return `${FileSystem.bundleDirectory ?? ""}web/index.html`;
}

// Which screen edges the native frame keeps clear of the system bars.
//
// iOS: none. The page is built to run edge to edge — `viewport-fit=cover`,
// and every surface that meets an edge (the sticky headers, the side menu,
// the modals, toasts and bottom bars) pads itself with
// `env(safe-area-inset-*)` — which is how the installed PWA looks. Framing the
// WebView inside the safe area instead zeroes those insets and leaves a flat
// band above the page, so the side menu and the headers stop short of the
// status bar.
//
// Android: top and the sides, as before. The WebView's safe-area insets are
// not reliably reported there, so the frame keeps the page clear of the
// status bar and any display cutout.
const FRAME_EDGES =
  Platform.OS === "ios" ? ([] as const) : (["top", "left", "right"] as const);

export default function WebViewHost() {
  const webView = useRef<WebView>(null);
  const bundleDir = FileSystem.bundleDirectory ?? undefined;
  // The in-flight QR-scan request id, set when the web app asks to scan and
  // cleared once the camera overlay resolves.
  const [scanId, setScanId] = useState<string | null>(null);
  // The page's resolved theme, for the status bar and the background behind
  // the WebView. Null until the page reports one.
  const { injectedJavaScript, theme, onThemeMessage } = useNativeTheme();
  const background = theme?.background ?? BACKGROUND;
  const barStyle = theme?.barStyle ?? "light";

  // One sign-in. The sheet is modal and the page waits on it; what comes back
  // is the provider's redirect URL, handed straight to the page, which holds
  // the PKCE verifier and makes the token exchange itself.
  const signIn = useCallback(async (id: string, url: string) => {
    if (!AUTH_REDIRECT_URI) return;
    const result = await answerAuthSession(url, AUTH_REDIRECT_URI);
    webView.current?.injectJavaScript(authSessionResolveScript(id, result));
  }, []);

  // Deliver a scan result back into the page and tear the overlay down. Bodies
  // stay tiny (a decoded string) so no base64 dance is needed.
  const resolveScan = (id: string, value: string | null) => {
    webView.current?.injectJavaScript(
      `window.__NOTES_NATIVE__ && window.__NOTES_NATIVE__.resolveQr(${JSON.stringify(
        { id, value },
      )}); true;`,
    );
    setScanId(null);
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={[styles.root, { backgroundColor: background }]}
        edges={FRAME_EDGES}
      >
        {/* Styled from the page's own background, not the system appearance:
            on iOS the page runs under the status bar, and "auto" draws dark
            icons over a dark theme whenever the system is in light mode. */}
        <StatusBar style={barStyle} />
        <WebView
          ref={webView}
          source={{ uri: indexUri() }}
          // The bundle is loaded over file://; keep the whitelist tight.
          originWhitelist={["file://*", "about:*"]}
          allowFileAccess
          allowFileAccessFromFileURLs
          // iOS needs explicit read access to the bundle dir so the file://
          // page can pull its sibling hashed assets.
          allowingReadAccessToURL={
            Platform.OS === "ios" ? bundleDir : undefined
          }
          // localStorage is the web app's entire persistence layer, so it must
          // stay on (Android gates it behind this flag).
          domStorageEnabled
          javaScriptEnabled
          setSupportMultipleWindows={false}
          // iOS runs full-bleed (see `FRAME_EDGES`), so the scroll view must
          // not pad itself back down by the safe area: the page does that,
          // through `env(safe-area-inset-*)`, exactly as the installed PWA.
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          // The iCloud and sign-in providers, installed before the page's own
          // scripts run so the storage picker can offer iCloud Drive and
          // Dropbox on the first render. Both are guarded against a second
          // injection.
          injectedJavaScriptBeforeContentLoaded={`${ICLOUD_SCRIPT}\n${AUTH_SESSION_SCRIPT}`}
          // The theme reporter (see `./nativeTheme.ts`), once the page has
          // painted and its theme engine has set `data-theme`.
          injectedJavaScript={injectedJavaScript}
          onMessage={(event: WebViewMessageEvent) => {
            if (onThemeMessage(event)) return;
            const raw = event.nativeEvent.data;
            const parsed = parseMessage(raw);
            if (isICloudRequest(parsed)) {
              // Answered without caching or logging — the payload is the
              // user's notes. See `icloud.ts`.
              void answerICloud(parsed.method, parsed.args).then((result) =>
                webView.current?.injectJavaScript(
                  resolveScript(parsed.id, result),
                ),
              );
              return;
            }
            if (isAuthSessionRequest(parsed)) {
              void signIn(parsed.id, parsed.url);
              return;
            }
            void handleBridgeMessage(raw, {
              inject: (script) => webView.current?.injectJavaScript(script),
              scanQr: (id) => setScanId(id),
            });
          }}
          style={styles.web}
        />
        {scanId !== null && (
          <QrScanner onResult={(value) => resolveScan(scanId, value)} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BACKGROUND },
  web: { flex: 1, backgroundColor: "transparent" },
});
