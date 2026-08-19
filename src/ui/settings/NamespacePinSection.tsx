import { useState, type FormEvent } from "react";

import { useT } from "../../i18n/index.ts";
import { PIN_MIN_LENGTH } from "../../storage/namespace-pin.ts";
import type { UseStorageBackend } from "../../storage/useStorageBackend.ts";
import { Button } from "../form/Button.tsx";
import { LockIcon } from "../icons.tsx";
import { Section } from "./shared.tsx";

// The **namespace PIN** control, in Storage settings directly above
// encryption — which is where the comparison belongs. Both protect the active
// namespace, and the two lines of copy here exist to stop anyone mistaking the
// cheap one for the real one: a PIN gates *opening* the namespace, encryption
// gates *reading* it, and only the second survives someone who can read the
// synced folder. The framework's namespaces dialog owns its own surface with
// no room for a per-row control, so this lives here rather than beside the
// rename/delete verbs.
//
// Everything is about the active namespace, named in every line, because both
// protections are per namespace.

export function NamespacePinSection({
  storage,
}: {
  storage: UseStorageBackend;
}) {
  const t = useT();
  const [editing, setEditing] = useState<"set" | "remove" | null>(null);
  const [current, setCurrent] = useState("");
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const slug = storage.activeNamespace;
  const namespace =
    storage.namespaces.find((n) => n.slug === slug)?.name ?? slug;
  const hasPin = storage.namespaceHasPin(slug);

  const reset = () => {
    setEditing(null);
    setCurrent("");
    setCode("");
    setConfirm("");
    setError(null);
  };

  const submitSet = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (code.length < PIN_MIN_LENGTH) {
      setError(t("namespace.pinTooShort", { min: PIN_MIN_LENGTH }));
      return;
    }
    if (code !== confirm) {
      setError(t("namespace.pinMismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (await storage.setNamespacePin(slug, code, current)) reset();
      else setError(t("namespace.pinWrong"));
    } finally {
      setBusy(false);
    }
  };

  const submitRemove = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (await storage.clearNamespacePin(slug, current)) reset();
      else setError(t("namespace.pinWrong"));
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "rounded-[var(--radius)] border border-line bg-surface-2 px-2 py-1.5 text-sm text-fg outline-none focus:border-accent";

  return (
    <Section title={t("namespace.pinTitle")}>
      <div className="flex items-start gap-3">
        <LockIcon
          className={`mt-0.5 h-5 w-5 ${hasPin ? "text-accent" : "text-muted"}`}
        />
        <div className="flex-1">
          <h3 className="text-sm font-bold text-fg-bright">
            {hasPin
              ? t("namespace.pinOn", { namespace })
              : t("namespace.pinOff", { namespace })}
          </h3>
          <p className="mt-1 text-xs text-muted">{t("namespace.pinHint")}</p>
          <p className="mt-1 text-xs text-muted">
            {t("namespace.pinSoftWarning")}
          </p>
        </div>
      </div>

      {editing === null && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => setEditing("set")}>
            {hasPin ? t("namespace.pinChange") : t("namespace.pinSet")}
          </Button>
          {hasPin && (
            <Button variant="secondary" onClick={() => setEditing("remove")}>
              {t("namespace.pinRemove")}
            </Button>
          )}
        </div>
      )}

      {editing === "set" && (
        <form
          onSubmit={(e) => void submitSet(e)}
          className="flex flex-col gap-2"
        >
          {hasPin && (
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={current}
              onInput={(e) => setCurrent((e.target as HTMLInputElement).value)}
              aria-label={t("namespace.pinCurrentLabel")}
              placeholder={t("namespace.pinCurrentLabel")}
              className={inputClass}
            />
          )}
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={code}
            onInput={(e) => setCode((e.target as HTMLInputElement).value)}
            aria-label={t("namespace.pinLabel")}
            placeholder={t("namespace.pinLabel")}
            className={inputClass}
          />
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={confirm}
            onInput={(e) => setConfirm((e.target as HTMLInputElement).value)}
            aria-label={t("namespace.pinConfirmLabel")}
            placeholder={t("namespace.pinConfirmLabel")}
            className={inputClass}
          />
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button variant="primary" type="submit" disabled={busy}>
              {t("common.save")}
            </Button>
            <Button variant="secondary" onClick={reset}>
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      )}

      {editing === "remove" && (
        <form
          onSubmit={(e) => void submitRemove(e)}
          className="flex flex-col gap-2"
        >
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={current}
            onInput={(e) => setCurrent((e.target as HTMLInputElement).value)}
            aria-label={t("namespace.pinCurrentLabel")}
            placeholder={t("namespace.pinCurrentLabel")}
            className={inputClass}
          />
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button variant="danger" type="submit" disabled={busy}>
              {t("namespace.pinRemove")}
            </Button>
            <Button variant="secondary" onClick={reset}>
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}
