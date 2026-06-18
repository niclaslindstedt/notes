import { useState, type FormEvent } from "react";

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
        setError(
          "You're offline and nothing is cached on this device yet. Connect to the internet and try again.",
        );
      } else {
        setError("That passphrase didn't work.");
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
            Notes are locked
          </h1>
        </div>
        <p className="text-xs text-muted">
          Enter your passphrase to unlock and read your notes on this device.
        </p>
        <input
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder="Passphrase"
          aria-label="Passphrase"
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
          Unlock
        </button>
      </form>
    </div>
  );
}
