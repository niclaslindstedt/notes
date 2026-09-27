// Routes messages the web app posts over the WebView bridge to native code.
// The protocol is documented in `src/platform/native-bridge.ts` and
// `native/README.md`: one fire-and-forget message, for haptics.

import { Platform, Vibration } from "react-native";
import * as Haptics from "expo-haptics";

interface HapticsMessage {
  type: "haptics.vibrate";
  pattern?: number | number[];
}

type BridgeMessage = HapticsMessage;

export function handleBridgeMessage(raw: string): void {
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
