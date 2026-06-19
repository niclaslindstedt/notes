import { useState, type FormEvent } from "react";

import { useT } from "../i18n/index.ts";
import { OfflineUnavailableError } from "../storage/cache/index.ts";
import type { UseStorageBackend } from "../storage/useStorageBackend.ts";
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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !pass) return;
    setBusy(true);
    setError(null);
    try {
      await storage.unlock(pass);
      setPass("");
    } catch (err) {
      if (err instanceof OfflineUnavailableError) {
        setError(t("settings.unlock.offline"));
      } else {
        setError(t("settings.unlock.wrong"));
      }
    } finally {
      setBusy(false);
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
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          className="rounded-[var(--radius)] border border-line bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-accent"
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
          {t("settings.unlock.unlock")}
        </button>
      </form>
    </div>
  );
}
