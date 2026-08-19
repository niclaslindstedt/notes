import { useRef, useState, type FormEvent } from "react";

import { useT } from "../i18n/index.ts";
import type { UseStorageBackend } from "../storage/useStorageBackend.ts";
import { LockedNamespaceSwitcher } from "./LockedNamespaceSwitcher.tsx";
import { Button } from "./form/Button.tsx";
import { LockIcon } from "./icons.tsx";

// Full-screen gate shown when the active namespace carries a PIN that hasn't
// been entered this session. Sits in front of the app the same way the
// encryption unlock gate does — and, like it, carries the namespace switcher,
// because both locks are per namespace and neither may strand you in one.
//
// The PIN is asked for before the passphrase when a namespace has both: it is
// the cheaper of the two and covers the common case (a mis-tap, a borrowed
// phone). While it is up the storage adapter is the locked placeholder, so the
// namespace's notes are never read into memory behind it.

export function NamespacePinGate({ storage }: { storage: UseStorageBackend }) {
  const t = useT();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const active = storage.namespaces.find(
    (n) => n.slug === storage.activeNamespace,
  );
  const namespace = active?.name ?? storage.activeNamespace;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (await storage.enterNamespacePin(code)) setCode("");
      else setError(t("namespace.pinWrong"));
    } finally {
      setBusy(false);
      inputRef.current?.focus({ preventScroll: true });
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-page-bg px-4">
        <form
          onSubmit={(e) => void submit(e)}
          aria-labelledby="pin-gate-title"
          className="flex w-full max-w-sm flex-col gap-3 rounded-md border border-line bg-surface p-5"
        >
          <div className="flex items-center gap-2 text-accent">
            <LockIcon className="h-6 w-6" />
            <h1
              id="pin-gate-title"
              className="text-base font-bold text-fg-bright"
            >
              {t("namespace.pinGateTitle", { namespace })}
            </h1>
          </div>
          <p className="text-sm text-muted">{t("namespace.pinGateHint")}</p>
          <input
            ref={inputRef}
            type="password"
            // A numeric keypad is the right default for a code most people
            // will make digits, without refusing the longer alphanumeric one
            // the copy recommends.
            inputMode="numeric"
            autoComplete="off"
            value={code}
            onInput={(e) => setCode((e.target as HTMLInputElement).value)}
            aria-label={t("namespace.pinLabel")}
            placeholder={t("namespace.pinLabel")}
            className="rounded-[var(--radius)] border border-line bg-surface-2 px-2 py-1.5 text-sm text-fg outline-none focus:border-accent"
          />
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <Button variant="primary" type="submit" disabled={!code || busy}>
            {t("namespace.pinGateSubmit")}
          </Button>
        </form>
      </div>
      <LockedNamespaceSwitcher storage={storage} />
    </>
  );
}
