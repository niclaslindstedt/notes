import { UnlockGate as FrameworkUnlockGate } from "@niclaslindstedt/oss-framework/components";

import { useT } from "../i18n/index.ts";
import { OfflineUnavailableError } from "../storage/cache/index.ts";
import type {
  EncryptionProgress,
  UseStorageBackend,
} from "../storage/useStorageBackend.ts";
import { UNLOCK_STEP_MESSAGE_KEY } from "./encryption-progress.ts";

// Full-screen unlock gate shown when encryption is on but no passphrase is
// held this session (a fresh reload). The framework component owns the
// screen (form, busy state, progress line, error display); this wrapper
// binds it to the app's storage unlock flow, maps the offline error apart
// from a genuinely wrong passphrase, and injects the translated strings —
// including the per-note decrypt progress detail.

type Props = {
  storage: UseStorageBackend;
  // True when the gate appeared because the backend was found encrypted
  // (encryption turned on from another device), not a plain reload of a store
  // this device already had encrypted. Swaps the hint to explain the handoff.
  fromRemote?: boolean;
};

export function UnlockGate({ storage, fromRemote = false }: Props) {
  const t = useT();
  return (
    <FrameworkUnlockGate
      open
      onUnlock={async (password, onProgress) => {
        const progress: EncryptionProgress = (s, detail) =>
          onProgress(
            detail
              ? t("settings.unlock.decryptingNote", {
                  title: detail.title || t("settings.unlock.untitledNote"),
                  index: detail.index,
                  total: detail.total,
                })
              : t(UNLOCK_STEP_MESSAGE_KEY[s]),
          );
        await storage.unlock(password, progress);
      }}
      mapError={(err) =>
        err instanceof OfflineUnavailableError
          ? t("settings.unlock.offline")
          : null
      }
      labels={{
        title: t("settings.unlock.title"),
        hint: fromRemote
          ? t("settings.unlock.hintRemote")
          : t("settings.unlock.hint"),
        passphrase: t("settings.unlock.passphrase"),
        unlock: t("settings.unlock.unlock"),
        error: t("settings.unlock.wrong"),
        statusAria: t("settings.unlock.statusAria"),
      }}
    />
  );
}
