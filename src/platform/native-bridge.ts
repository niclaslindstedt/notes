// The seam between the web app and the thin native WebView wrapper (`native/`).
//
// On the web this module is inert: `isNative()` is false and `haptics.vibrate`
// falls back to `navigator.vibrate`. Inside the wrapper,
// `window.ReactNativeWebView` exists (injected by react-native-webview) and the
// one capability the web can't provide — real haptics — routes out to native
// code over a small JSON message.
//
// ## Message protocol
//
// web → native (`window.ReactNativeWebView.postMessage(JSON.stringify(msg))`):
//
//   { v: 1, type: "haptics.vibrate", pattern }
//
// Fire-and-forget: nothing comes back. The wrapper's other two capabilities,
// iCloud Drive and the sign-in sheet, are providers the page finds on
// `window` rather than messages it sends (`icloud-host.ts`, the framework's
// `getAuthSessionHost`).

const PROTOCOL_VERSION = 1;

interface ReactNativeWebView {
  postMessage(message: string): void;
}

declare global {
  interface Window {
    ReactNativeWebView?: ReactNativeWebView;
  }
}

/** True when running inside the native WebView wrapper. */
export function isNative(): boolean {
  return typeof window !== "undefined" && !!window.ReactNativeWebView;
}

function post(message: unknown): void {
  if (typeof window === "undefined") return;
  window.ReactNativeWebView?.postMessage(JSON.stringify(message));
}

// ---------------------------------------------------------------------------
// Haptics
// ---------------------------------------------------------------------------

export const haptics = {
  /**
   * Fire a short vibration. Inside the wrapper this reaches real native
   * haptics (iOS WKWebView ignores `navigator.vibrate` entirely); on the web
   * it falls back to the Vibration API where supported.
   */
  vibrate(pattern: number | number[]): void {
    if (isNative()) {
      post({ v: PROTOCOL_VERSION, type: "haptics.vibrate", pattern });
      return;
    }
    if (typeof navigator !== "undefined") navigator.vibrate?.(pattern);
  },
};
