// The seam between the web app and the thin native WebView wrapper (`native/`).
//
// On the web this module is inert: `isNative()` is false, `haptics.vibrate`
// falls back to `navigator.vibrate`, and `pinnedFetch` is simply never called.
// Inside the wrapper, `window.ReactNativeWebView` exists (injected by
// react-native-webview) and the two capabilities the web can't provide route
// out to native code over a small JSON message protocol.
//
// ## Message protocol
//
// web → native (`window.ReactNativeWebView.postMessage(JSON.stringify(msg))`):
//
//   { v: 1, type: "haptics.vibrate", pattern }
//   { v: 1, type: "pinnedFetch.request",
//     id, url, method, headers, bodyBase64 | null, spkiPin }
//
// native → web (injected by native as
// `window.__NOTES_NATIVE__.resolve(payload)`, since react-native-webview's
// native→web channel is script injection, not postMessage):
//
//   { id, ok, status, statusText, headers, bodyBase64 | null,
//     error?: { name, message } }
//
// Bodies are base64 because both channels are string-only and notesd payloads
// carry binary (encrypted) envelopes.

const PROTOCOL_VERSION = 1;

interface ReactNativeWebView {
  postMessage(message: string): void;
}

interface PinnedFetchReply {
  id: string;
  ok?: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  bodyBase64?: string | null;
  error?: { name?: string; message?: string };
}

declare global {
  interface Window {
    ReactNativeWebView?: ReactNativeWebView;
    // Installed by this module; called by the native side to deliver a
    // `pinnedFetch` reply back into the page.
    __NOTES_NATIVE__?: { resolve(payload: PinnedFetchReply): void };
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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
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

// ---------------------------------------------------------------------------
// SPKI-pinned fetch
// ---------------------------------------------------------------------------

interface Pending {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
}

const pending = new Map<string, Pending>();

// Install the native→web receiver once, eagerly, so it is ready before any
// `pinnedFetch` reply arrives. Harmless on the web (never invoked).
if (typeof window !== "undefined") {
  window.__NOTES_NATIVE__ = {
    resolve(payload: PinnedFetchReply) {
      const entry = pending.get(payload.id);
      if (!entry) return;
      pending.delete(payload.id);
      if (payload.error) {
        const err = new Error(payload.error.message ?? "pinnedFetch failed");
        err.name = payload.error.name ?? "PinnedFetchError";
        entry.reject(err);
        return;
      }
      // `base64ToBytes` allocates an exactly-sized buffer, so its whole
      // `ArrayBuffer` is the body (the DOM `BodyInit` typing accepts an
      // `ArrayBuffer` cleanly where a bare `Uint8Array` trips the checker).
      const body: BodyInit | null = payload.bodyBase64
        ? (base64ToBytes(payload.bodyBase64).buffer as ArrayBuffer)
        : null;
      entry.resolve(
        new Response(body, {
          status: payload.status ?? 200,
          statusText: payload.statusText ?? "",
          headers: payload.headers ?? {},
        }),
      );
    },
  };
}

/**
 * Perform an HTTPS request whose TLS certificate is validated against a
 * pinned SPKI SHA-256 fingerprint by native code, bypassing the system CA
 * store. This is how the app reaches a self-hosted `notesd` daemon, which
 * serves a self-signed certificate that no public CA would vouch for.
 *
 * Only usable inside the native wrapper; rejects on the plain web (a browser
 * cannot pin, and there is no self-signed daemon to reach there).
 */
export function pinnedFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  spkiPin: string,
): Promise<Response> {
  if (!isNative()) {
    return Promise.reject(
      new Error("pinnedFetch is only available in the native wrapper"),
    );
  }

  // Normalise every accepted body shape (string, BufferSource, Blob,
  // URLSearchParams, FormData) through a Request so we only ever serialise
  // bytes across the bridge.
  const request = new Request(input, init);
  const readBody =
    request.method === "GET" || request.method === "HEAD"
      ? Promise.resolve<ArrayBuffer | null>(null)
      : request
          .clone()
          .arrayBuffer()
          .then((buf) => (buf.byteLength ? buf : null));

  return readBody.then((buf) => {
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const id = crypto.randomUUID();
    return new Promise<Response>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      post({
        v: PROTOCOL_VERSION,
        type: "pinnedFetch.request",
        id,
        url: request.url,
        method: request.method,
        headers,
        bodyBase64: buf ? bytesToBase64(new Uint8Array(buf)) : null,
        spkiPin,
      });
    });
  });
}

/**
 * Bind a pin to produce a `fetch`-shaped function. This is the seam the
 * (phase-6) notesd `StorageAdapter` consumes: it takes a `FetchImpl =
 * typeof fetch`, so it will pass `createPinnedFetch(pin)` in
 * `src/storage/useBackendSelection.ts` exactly where the Dropbox and Google
 * Drive backends pass the raw global `fetch`.
 */
export function createPinnedFetch(spkiPin: string): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    pinnedFetch(input, init, spkiPin)) as typeof fetch;
}
