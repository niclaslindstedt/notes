// Routes messages the web app posts over the WebView bridge to native code.
// The protocol (web → native envelopes, native → web injected replies) is
// documented in `src/platform/native-bridge.ts` and `native/README.md`.

import { Platform, Vibration } from "react-native";
import * as Haptics from "expo-haptics";

import { pinnedFetch, type PinnedResponse } from "../../modules/pinned-fetch";

export interface NativeReply {
  /** Run a snippet in the WebView (react-native-webview's native→web channel). */
  inject: (script: string) => void;
  /**
   * Open the camera overlay to read a QR code for pairing. The host resolves
   * the request back into the page itself (via `resolveQr`) once the scan
   * finishes or is dismissed, so the pure message handler stays UI-free.
   */
  scanQr: (id: string) => void;
}

interface HapticsMessage {
  type: "haptics.vibrate";
  pattern?: number | number[];
}

interface PinnedFetchMessage {
  type: "pinnedFetch.request";
  id: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  bodyBase64?: string | null;
  spkiPin: string;
}

interface QrScanMessage {
  type: "qr.scan.request";
  id: string;
}

type BridgeMessage = HapticsMessage | PinnedFetchMessage | QrScanMessage;

export async function handleBridgeMessage(
  raw: string,
  reply: NativeReply,
): Promise<void> {
  let message: BridgeMessage;
  try {
    message = JSON.parse(raw) as BridgeMessage;
  } catch {
    return; // Not our envelope — ignore.
  }
  if (!message || typeof message !== "object") return;

  switch (message.type) {
    case "haptics.vibrate":
      vibrate(message.pattern);
      return;
    case "pinnedFetch.request":
      await handlePinnedFetch(message, reply);
      return;
    case "qr.scan.request":
      reply.scanQr(message.id);
      return;
    default:
      return;
  }
}

function vibrate(pattern: number | number[] | undefined): void {
  if (Platform.OS === "ios") {
    // iOS ignores duration/patterns from the web; map to a light impact so
    // the gesture still gets tactile feedback.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
      () => undefined,
    );
    return;
  }
  Vibration.vibrate(pattern ?? 8);
}

async function handlePinnedFetch(
  message: PinnedFetchMessage,
  reply: NativeReply,
): Promise<void> {
  try {
    const res: PinnedResponse = await pinnedFetch({
      url: message.url,
      method: message.method ?? "GET",
      headers: message.headers ?? {},
      bodyBase64: message.bodyBase64 ?? null,
      spkiPin: message.spkiPin,
    });
    respond(reply, {
      id: message.id,
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
      bodyBase64: res.bodyBase64,
    });
  } catch (error) {
    const err = error as { name?: string; message?: string };
    respond(reply, {
      id: message.id,
      error: {
        name: err.name ?? "PinnedFetchError",
        message: err.message ?? String(error),
      },
    });
  }
}

function respond(reply: NativeReply, payload: unknown): void {
  // The trailing `true;` keeps WKWebView from complaining about a non-JSON
  // evaluation result.
  reply.inject(
    `window.__NOTES_NATIVE__ && window.__NOTES_NATIVE__.resolve(${JSON.stringify(
      payload,
    )}); true;`,
  );
}
