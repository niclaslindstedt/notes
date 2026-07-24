// The entire native app: a single full-screen WebView that loads the compiled
// web PWA embedded in the binary (built by `make build-native` into
// `native/web/` and copied in at prebuild by `plugins/with-web-bundle.js`).
//
// Everything the user sees is the web app running offline from local files.
// The only things this shell adds are the capabilities a WebView can't
// provide, routed over the bridge in `bridge/on-message.ts`:
//   1. real haptics (iOS WKWebView ignores `navigator.vibrate`),
//   2. SPKI-pinned HTTPS for a self-hosted notesd daemon, and
//   3. a QR camera scan (the `QrScanner` overlay) for pairing that daemon.
//
// See `native/README.md` for the message protocol and the web-side seam in
// `src/platform/native-bridge.ts`.

import { useRef, useState } from "react";
import { Platform, StyleSheet } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as FileSystem from "expo-file-system";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { handleBridgeMessage } from "./bridge/on-message";
import QrScanner from "./QrScanner";

// Where the embedded bundle's entry point lives on each platform. Android
// keeps it under the APK's `assets/`; iOS under the app bundle, whose file URL
// `expo-file-system` exposes as `bundleDirectory`.
function indexUri(): string {
  if (Platform.OS === "android") {
    return "file:///android_asset/web/index.html";
  }
  return `${FileSystem.bundleDirectory ?? ""}web/index.html`;
}

export default function WebViewHost() {
  const webView = useRef<WebView>(null);
  const bundleDir = FileSystem.bundleDirectory ?? undefined;
  // The in-flight QR-scan request id, set when the web app asks to scan and
  // cleared once the camera overlay resolves.
  const [scanId, setScanId] = useState<string | null>(null);

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
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <StatusBar style="auto" />
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
          // Drop the iOS keyboard accessory bar (the "< > ✓" strip WKWebView
          // floats above the keyboard). It ate a row of space above the note,
          // and the web app now dismisses the keyboard with a downward pull
          // from the top of the note instead (see `useSwipeDownDismiss`).
          hideKeyboardAccessoryView
          // localStorage is the web app's entire persistence layer, so it must
          // stay on (Android gates it behind this flag).
          domStorageEnabled
          javaScriptEnabled
          setSupportMultipleWindows={false}
          onMessage={(event: WebViewMessageEvent) => {
            void handleBridgeMessage(event.nativeEvent.data, {
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
  root: { flex: 1, backgroundColor: "#1d2027" },
  web: { flex: 1, backgroundColor: "transparent" },
});
