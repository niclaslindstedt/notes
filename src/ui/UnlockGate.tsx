import { UnlockGate as FrameworkUnlockGate } from "@niclaslindstedt/oss-framework/components";

import { useT } from "../i18n/index.ts";
import { OfflineUnavailableError } from "../storage/cache/offline-error.ts";
import type {
  EncryptionProgress,
  UseStorageBackend,
} from "../storage/useStorageBackend.ts";
import { UNLOCK_STEP_MESSAGE_KEY } from "./encryption-progress.ts";
import { LockedNamespaceSwitcher } from "./LockedNamespaceSwitcher.tsx";

// Full-screen unlock gate shown when the **active namespace** is encrypted and
// no passphrase is held for it this session (a fresh reload, or a namespace
// someone else sealed). The framework component owns the screen (form, busy
// state, progress line, error display); this wrapper binds it to the app's
// storage unlock flow, maps the offline error apart from a genuinely wrong
// passphrase, and injects the translated strings — including the per-note
// decrypt progress detail.
//
// Encryption is per namespace, so the gate is too: it names the namespace it
// is asking about, and it carries a way out — see `LockedNamespaceSwitcher`.

type Props = {
  storage: UseStorageBackend;
  // True when the gate appeared because the namespace was found encrypted
  // (encryption turned on from another device), not a plain reload of one this
  // device already had encrypted. Swaps the hint to explain the handoff.
  fromRemote?: boolean;
};

export function UnlockGate({ storage, fromRemote = false }: Props) {
  const t = useT();
  const active = storage.namespaces.find(
    (n) => n.slug === storage.activeNamespace,
  );
  const namespace = active?.name ?? storage.activeNamespace;

  return (
    <>
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
          title: t("settings.unlock.title", { namespace }),
          hint: fromRemote
            ? t("settings.unlock.hintRemote", { namespace })
            : t("settings.unlock.hint", { namespace }),
          passphrase: t("settings.unlock.passphrase"),
          unlock: t("settings.unlock.unlock"),
          error: t("settings.unlock.wrong"),
          statusAria: t("settings.unlock.statusAria"),
        }}
      />
      <LockedNamespaceSwitcher storage={storage} />
    </>
  );
}
