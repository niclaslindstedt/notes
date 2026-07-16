// The notesd (self-hosted daemon) backend concern: the paired-config state and
// the pair / unpair verbs. The native counterpart of `useCloudBackend`, but
// pairing is a QR/paste flow over an SPKI-pinned fetch rather than an OAuth
// redirect — so it lives in its own leaf hook.
//
// Only reachable inside the native wrapper: `createPinnedFetch` rejects on the
// plain web (a browser can't pin a self-signed cert), which is exactly the gate
// that makes notesd a native-only backend. The UI hides the option off-native;
// `pairNotesd` guards defensively too.

import { useCallback, useState } from "react";

import { unlock as unlockAchievement } from "../achievements/index.ts";
import { createLogger } from "../dev/logger.ts";
import { createPinnedFetch, isNative } from "../platform/native-bridge.ts";
import {
  type BackendId,
  type NotesdConfig,
  clearNotesdConfig,
  getNotesdConfig,
  setNotesdConfig,
} from "./backend-preference.ts";
import { type NotesdPairing, pairingEndpoint } from "./notesd/pairing.ts";

const log = createLogger("notesd");

export interface UseNotesdBackendOptions {
  /** Persist + activate a backend (switch to notesd on pair, browser on unpair). */
  selectBackend: (id: BackendId) => void;
}

export interface NotesdBackend {
  /** The paired daemon config, or null when none is paired. */
  notesdConfig: NotesdConfig | null;
  /**
   * Pair with a daemon from a parsed `notesd://pair` URI: redeem the one-time
   * token for a per-device key (or adopt the static key), store the config, and
   * switch to the notesd backend. Rejects off-native or on a failed redeem.
   */
  pairNotesd: (pairing: NotesdPairing) => Promise<void>;
  /** Forget the paired daemon and fall back to the browser store. */
  unpairNotesd: () => void;
}

// A short, non-identifying label so the daemon's device roster is readable
// ("iPhone", "Android", …) without leaking anything sensitive.
function deviceLabel(): string {
  if (typeof navigator === "undefined") return "device";
  const platform = navigator.platform || "";
  if (/iphone|ipad|ios/i.test(platform)) return "iOS";
  if (/android/i.test(navigator.userAgent || "")) return "Android";
  return platform || "device";
}

export function useNotesdBackend({
  selectBackend,
}: UseNotesdBackendOptions): NotesdBackend {
  const [notesdConfig, setNotesdConfigState] = useState<NotesdConfig | null>(
    getNotesdConfig,
  );

  const pairNotesd = useCallback(
    async (pairing: NotesdPairing) => {
      if (!isNative()) {
        throw new Error(
          "The self-hosted backend is only available in the app.",
        );
      }
      const endpoint = pairingEndpoint(pairing);
      const pinned = createPinnedFetch(pairing.fingerprint);

      let deviceKey: string;
      if (pairing.token) {
        // Redeem the single-use pairing token for this device's own key.
        const res = await pinned(`${endpoint}/v1/pair`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: pairing.token, label: deviceLabel() }),
        });
        if (!res.ok) {
          throw new Error(`Pairing was rejected (${res.status}).`);
        }
        const body = (await res.json()) as { key?: string };
        if (!body.key) throw new Error("The daemon returned no device key.");
        deviceKey = body.key;
      } else if (pairing.key) {
        // `--api-key` mode: the QR carries the static key directly.
        deviceKey = pairing.key;
      } else {
        throw new Error("The pairing code carries no credential.");
      }

      const config: NotesdConfig = {
        endpoint,
        deviceKey,
        spkiPin: pairing.fingerprint,
        name: pairing.name,
      };
      setNotesdConfig(config);
      setNotesdConfigState(config);
      selectBackend("notesd");
      unlockAchievement("selfHoster");
      log.info(`paired with ${pairing.name}`);
    },
    [selectBackend],
  );

  const unpairNotesd = useCallback(() => {
    clearNotesdConfig();
    setNotesdConfigState(null);
    selectBackend("browser");
  }, [selectBackend]);

  return { notesdConfig, pairNotesd, unpairNotesd };
}
