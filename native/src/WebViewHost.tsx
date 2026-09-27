// The entire native app: a single full-screen WebView over the compiled web
// PWA packed into the binary as `assets/webroot.zip` (`scripts/bundle-web.mjs`)
// and served from a loopback server on the device, `http://localhost:8311`
// (`local-server.ts`).
//
// Everything the user sees is the web app running offline, from inside the
// download. Links off that origin go to the system browser.
// The only things this shell adds are the capabilities a WebView can't
// provide:
//   1. real haptics (iOS WKWebView ignores `navigator.vibrate`), routed over
//      the bridge in `bridge/on-message.ts` —
// plus two the page finds rather than asks for:
//   2. an iCloud Drive file store (iOS), installed as a provider on `window`
//      by `ICLOUD_SCRIPT` and answered by `answerICloud` (`icloud*.ts`), and
//   3. an authentication session for signing in to Dropbox, installed as
//      `window.__ossAuthSession` by `authSessionScript` and answered by
//      `answerAuthSession` (`authSession*.ts`). A provider will neither show
//      its consent page inside an embedded WebView nor redirect back into
//      one; the session's sheet returns on `<bundle id>://oauth` instead.
//      The page asks whether each provider is there, never where it is running.
//
// See `native/README.md` for the message protocol and the web-side seams in
// `src/platform/native-bridge.ts` and `src/platform/icloud-host.ts`.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import {
  WebView,
  type WebViewMessageEvent,
  type WebViewNavigation,
} from "react-native-webview";

import { handleBridgeMessage } from "./bridge/on-message";
import { answerICloud } from "./icloud";
import { ICLOUD_SCRIPT, isICloudRequest, resolveScript } from "./icloudBridge";
import { answerAuthSession, authRedirectUri } from "./authSession";
import {
  authSessionResolveScript,
  authSessionScript,
  isAuthSessionRequest,
} from "./authSessionBridge";
import { useNativeTheme } from "./nativeTheme";
import { startLocalServer, type LocalServer } from "./local-server";
import { SERVICE_WORKER_TEARDOWN, staysInApp } from "./shell";

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
// flow cannot come back into the app.
const AUTH_REDIRECT_URI = authRedirectUri();
const AUTH_SESSION_SCRIPT = AUTH_REDIRECT_URI
  ? authSessionScript(AUTH_REDIRECT_URI)
  : "";

// The chrome shown before the page reports its theme: the page's pre-boot
// default (One Dark), with light status-bar icons over it. Once the WebView
// paints, `useNativeTheme` takes over with the live theme.
const BACKGROUND = "#1d2027";

type ServerState =
  | { status: "starting" }
  | { status: "ready"; origin: string }
  | { status: "failed"; error: Error };

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
  const canGoBack = useRef(false);
  const serverRef = useRef<LocalServer | null>(null);
  const [server, setServer] = useState<ServerState>({ status: "starting" });
  // The page's resolved theme, for the status bar and the background behind
  // the WebView. Null until the page reports one.
  const { injectedJavaScript, theme, onThemeMessage } = useNativeTheme();
  const background = theme?.background ?? BACKGROUND;
  const barStyle = theme?.barStyle ?? "light";

  // --- the embedded server --------------------------------------------------

  const start = useCallback(async () => {
    setServer({ status: "starting" });
    try {
      const running = await startLocalServer();
      serverRef.current = running;
      setServer({ status: "ready", origin: running.origin });
    } catch (error) {
      setServer({
        status: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }, []);

  useEffect(() => {
    void start();
    return () => {
      void serverRef.current?.stop();
    };
  }, [start]);

  // Android's back button walks the page's history — the notes visited, which
  // the page keeps as hash routes — and leaves the app only from the first.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack.current) return false;
      webView.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, []);

  const origin = server.status === "ready" ? server.origin : null;

  // Keep the WebView on the embedded app; anything else opens in the system
  // browser (see `staysInApp`). A provider's sign-in page is never navigated
  // to at all — the page asks for an authentication session instead.
  const onShouldStartLoadWithRequest = useCallback(
    (request: WebViewNavigation) => {
      if (!origin) return false;
      if (staysInApp(request.url, origin)) return true;
      void Linking.openURL(request.url).catch(() => {});
      return false;
    },
    [origin],
  );

  // One sign-in. The sheet is modal and the page waits on it; what comes back
  // is the provider's redirect URL, handed straight to the page, which holds
  // the PKCE verifier and makes the token exchange itself.
  const signIn = useCallback(async (id: string, url: string) => {
    if (!AUTH_REDIRECT_URI) return;
    const result = await answerAuthSession(url, AUTH_REDIRECT_URI);
    webView.current?.injectJavaScript(authSessionResolveScript(id, result));
  }, []);

  if (server.status === "failed") {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.center}>
          <StatusBar style="light" />
          <Text style={styles.errorTitle}>Could not start Notes</Text>
          <Text style={styles.errorBody}>{server.error.message}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void start()}
            style={({ pressed }) => [
              styles.retryButton,
              pressed && styles.retryButtonPressed,
            ]}
          >
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

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
        {origin === null ? (
          <View style={styles.center}>
            <ActivityIndicator color="#abb2bf" />
          </View>
        ) : (
          <WebView
            ref={webView}
            source={{ uri: origin }}
            // localStorage is the web app's entire persistence layer, so it must
            // stay on (Android gates it behind this flag).
            domStorageEnabled
            javaScriptEnabled
            // Never `incognito`: it makes WKWebView storage non-persistent,
            // which would drop every note on exit.
            incognito={false}
            setSupportMultipleWindows={false}
            onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
            onNavigationStateChange={(nav) => {
              canGoBack.current = nav.canGoBack;
            }}
            // iOS runs full-bleed (see `FRAME_EDGES`), so the scroll view must
            // not pad itself back down by the safe area: the page does that,
            // through `env(safe-area-inset-*)`, exactly as the installed PWA.
            contentInsetAdjustmentBehavior="never"
            automaticallyAdjustContentInsets={false}
            // Before the page's own scripts run: the service-worker teardown
            // (see `./shell.ts`), and the iCloud and sign-in providers, so the
            // storage picker can offer iCloud Drive and Dropbox on the first
            // render. The providers are guarded against a second injection.
            injectedJavaScriptBeforeContentLoaded={`${SERVICE_WORKER_TEARDOWN}\n${ICLOUD_SCRIPT}\n${AUTH_SESSION_SCRIPT}`}
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
              handleBridgeMessage(raw);
            }}
            style={styles.web}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BACKGROUND },
  web: { flex: 1, backgroundColor: "transparent" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BACKGROUND,
    padding: 24,
  },
  errorTitle: {
    color: "#e6e6e6",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
    textAlign: "center",
  },
  errorBody: { color: "#abb2bf", fontSize: 14, textAlign: "center" },
  retryButton: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#2c313a",
  },
  retryButtonPressed: { backgroundColor: "#3e4451" },
  retryLabel: { color: "#e6e6e6", fontSize: 15, fontWeight: "600" },
});
