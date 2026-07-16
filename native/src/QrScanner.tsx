// A full-screen camera overlay that reads a single QR code for pairing a
// notesd daemon. Mounted by `WebViewHost` only while a `qr.scan.request` is in
// flight; it resolves back to the host through `onResult`, which injects the
// reply into the WebView (`window.__NOTES_NATIVE__.resolveQr`).
//
// The web app (`src/platform/native-bridge.ts`) treats `null` as "dismissed"
// and a string as the decoded code, feeding the latter straight into the
// existing `parsePairingUri → resolvePairing → pairNotesd` path.

import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from "expo-camera";

export default function QrScanner({
  onResult,
}: {
  // Called exactly once: the decoded QR text, or null when dismissed.
  onResult: (value: string | null) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [requested, setRequested] = useState(false);
  // A QR in view fires `onBarcodeScanned` on every frame; latch so pairing runs
  // once.
  const done = useRef(false);

  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onResult(value);
  };

  const onScanned = (result: BarcodeScanningResult) => {
    if (result.data) finish(result.data);
  };

  // Permission still resolving on mount.
  if (!permission) {
    return (
      <View style={styles.root}>
        <ActivityIndicator color="#ffffff" />
      </View>
    );
  }

  // Not granted yet — ask once, then show the outcome.
  if (!permission.granted) {
    if (!requested) {
      setRequested(true);
      void requestPermission();
      return (
        <View style={styles.root}>
          <ActivityIndicator color="#ffffff" />
        </View>
      );
    }
    return (
      <View style={styles.root}>
        <Text style={styles.message}>
          Camera access is needed to scan the pairing code.
        </Text>
        <Pressable
          style={styles.cancel}
          onPress={() => finish(null)}
          accessibilityRole="button"
        >
          <Text style={styles.cancelLabel}>Close</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={onScanned}
      />
      <View style={styles.reticle} pointerEvents="none" />
      <Text style={styles.hint}>Point at the notesd pairing QR</Text>
      <Pressable
        style={styles.cancel}
        onPress={() => finish(null)}
        accessibilityRole="button"
      >
        <Text style={styles.cancelLabel}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
  },
  reticle: {
    width: 240,
    height: 240,
    borderWidth: 2,
    borderColor: "#ffffff",
    borderRadius: 16,
    backgroundColor: "transparent",
  },
  hint: {
    position: "absolute",
    top: 96,
    color: "#ffffff",
    fontSize: 15,
    textAlign: "center",
    paddingHorizontal: 24,
  },
  message: {
    color: "#ffffff",
    fontSize: 15,
    textAlign: "center",
    paddingHorizontal: 32,
    marginBottom: 24,
  },
  cancel: {
    position: "absolute",
    bottom: 64,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  cancelLabel: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
});
