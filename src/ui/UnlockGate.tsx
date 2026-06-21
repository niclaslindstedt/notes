import { useState, type FormEvent } from "react";

import { useT } from "../i18n/index.ts";
import { OfflineUnavailableError } from "../storage/cache/index.ts";
import type {
  EncryptionProgress,
  UseStorageBackend,
} from "../storage/useStorageBackend.ts";
import { BusyLabel } from "./BusyLabel.tsx";
import { CipherGlyph } from "./CipherGlyph.tsx";
import { UNLOCK_STEP_MESSAGE_KEY } from "./encryption-progress.ts";
import { ShieldIcon } from "./icons.tsx";

// Full-screen unlock gate shown when encryption is on but no passphrase is
// held this session (a fresh reload). It covers the app so the encrypted
// notes never render until the passphrase decrypts them. The appearance
// settings stay plaintext, so this screen still wears the user's theme.
// Ported from checklist's unlock gate, adapted to notes.

type Props = {
  storage: UseStorageBackend;
};

export function UnlockGate({ storage }: Props) {
  const t = useT();
  const [pass, setPass] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The phase line the unlock flow reports while it checks the passphrase and
  // decrypts the notes, named in unlock-specific terms (see
  // UNLOCK_STEP_MESSAGE_KEY) so the gate hints at what's happening instead of
  // sitting blank.
  const [step, setStep] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !pass) return;
    setBusy(true);
    setError(null);
    setStep(null);
    const onProgress: EncryptionProgress = (s) =>
      setStep(t(UNLOCK_STEP_MESSAGE_KEY[s]));
    try {
      await storage.unlock(pass, onProgress);
      setPass("");
    } catch (err) {
      if (err instanceof OfflineUnavailableError) {
        setError(t("settings.unlock.offline"));
      } else {
        setError(t("settings.unlock.wrong"));
      }
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-page-bg px-4">
      <form
        onSubmit={submit}
        className="flex w-full max-w-sm flex-col gap-3 rounded-[var(--radius)] border border-line bg-surface p-5"
      >
        <div className="flex items-center gap-2 text-accent">
          <ShieldIcon className="h-6 w-6" />
          <h1 className="text-base font-bold text-fg-bright">
            {t("settings.unlock.title")}
          </h1>
        </div>
        <p className="text-xs text-muted">{t("settings.unlock.hint")}</p>
        <input
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder={t("settings.unlock.passphrase")}
          aria-label={t("settings.unlock.passphrase")}
          disabled={busy}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          className="rounded-[var(--radius)] border border-line bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-accent disabled:opacity-50"
        />
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !pass}
          className="cursor-pointer rounded-[var(--radius)] border border-accent bg-accent/15 px-3 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <BusyLabel busy={busy}>{t("settings.unlock.unlock")}</BusyLabel>
        </button>
        {busy && step && (
          <div
            role="status"
            aria-label={t("settings.unlock.statusAria")}
            className="flex items-center gap-2 rounded-[var(--radius)] border border-line bg-surface-2 px-2.5 py-1.5"
          >
            <CipherGlyph className="shrink-0 text-xs text-accent" />
            <span className="truncate text-xs text-muted">{step}</span>
          </div>
        )}
      </form>
    </div>
  );
}
