import { useMemo, useState, type FormEvent } from "react";

import { useT } from "../../i18n/index.ts";
import type { BackendId } from "../../storage/backend-preference.ts";
import {
  type NotesdPairing,
  parsePairingUri,
} from "../../storage/notesd/pairing.ts";
import type {
  EncryptionProgress,
  UseStorageBackend,
} from "../../storage/useStorageBackend.ts";
import { ShieldIcon } from "../icons.tsx";
import { BusyLabel } from "../BusyLabel.tsx";
import { CipherGlyph } from "../CipherGlyph.tsx";
import { STEP_MESSAGE_KEY } from "../encryption-progress.ts";
import { scrollFocusedIntoView } from "../hooks/scrollFocusedIntoView.ts";
import { Button } from "../form/Button.tsx";
import {
  EncryptionLogModal,
  type EncryptionConversionState,
  type EncryptionLogEntry,
} from "./EncryptionLogModal.tsx";
import { Section } from "./shared.tsx";

// Storage settings: pick the backend that persists the notes (this device /
// local folder / Dropbox / Google Drive) and toggle at-rest encryption.
// Ported from checklist's storage tab, adapted to notes' account-less,
// single-document model and inlined English strings (notes has no i18n layer).

type Props = {
  storage: UseStorageBackend;
  conversion: EncryptionConversionState;
};

export function StorageSection({ storage, conversion }: Props) {
  const t = useT();
  const {
    backend,
    dropboxConfigured,
    gdriveConfigured,
    dropboxConnected,
    gdriveConnected,
    folderAvailable,
    folderConnected,
    folderReconnectNeeded,
    notesdAvailable,
    notesdConnected,
    pairNotesd,
    unpairNotesd,
    encryption,
    selectBrowser,
    connectFolder,
    reconnectFolder,
    disconnectFolder,
    connectDropbox,
    disconnectDropbox,
    connectGdrive,
    disconnectGdrive,
    enableEncryption,
    disableEncryption,
  } = storage;

  const [gdriveError, setGdriveError] = useState<string | null>(null);
  // Opening the notesd panel with no daemon paired reveals the pair form.
  const [pairing, setPairing] = useState(false);

  const backendOptions: {
    value: BackendId;
    label: string;
    disabled?: boolean;
  }[] = [
    { value: "browser", label: t("settings.storage.backendBrowser") },
    {
      value: "folder",
      label: t("settings.storage.backendFolder"),
      disabled: !folderAvailable,
    },
    {
      value: "dropbox",
      label: t("settings.storage.backendDropbox"),
      disabled: !dropboxConfigured,
    },
    {
      value: "gdrive",
      label: t("settings.storage.backendGoogleDrive"),
      disabled: !gdriveConfigured,
    },
    // Self-hosted is native-only: the SPKI-pinned fetch it needs exists only in
    // the app wrapper, so the option simply isn't offered on the plain web.
    ...(notesdAvailable
      ? [
          {
            value: "notesd" as const,
            label: t("settings.storage.backendNotesd"),
          },
        ]
      : []),
  ];

  const connectGdriveWithCapture = async () => {
    setGdriveError(null);
    try {
      await connectGdrive();
    } catch (err) {
      setGdriveError(err instanceof Error ? err.message : String(err));
    }
  };

  const onPickBackend = (next: BackendId) => {
    setGdriveError(null);
    if (next === backend) return;
    if (next === "browser") selectBrowser();
    else if (next === "folder") void connectFolder();
    else if (next === "dropbox") connectDropbox();
    else if (next === "gdrive") void connectGdriveWithCapture();
    // notesd doesn't auto-connect on pick — it reveals the pair form (a QR /
    // paste flow), and only switches backend once pairing succeeds.
    else if (next === "notesd") setPairing(!notesdConnected);
  };

  return (
    <>
      <Section title={t("settings.storage.backendTitle")}>
        <p className="text-xs text-muted">
          {t("settings.storage.backendBlurb")}
        </p>
        <div
          role="radiogroup"
          aria-label={t("settings.storage.backendAria")}
          className="flex flex-wrap gap-2"
        >
          {backendOptions.map((opt) => {
            const active = opt.value === backend;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={opt.disabled}
                onClick={() => onPickBackend(opt.value)}
                className={`cursor-pointer rounded-[var(--radius)] border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                  active
                    ? "border-accent bg-accent/15 font-bold text-accent"
                    : "border-line bg-surface-2 text-fg hover:bg-surface-3"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {backend === "browser" && (
          <p className="text-xs text-muted">
            {t("settings.storage.browserHint")}
          </p>
        )}

        {backend === "folder" && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted">
              {folderReconnectNeeded
                ? t("settings.storage.folderReconnectHint")
                : folderConnected
                  ? t("settings.storage.folderConnected")
                  : t("settings.storage.folderUnconnected")}
            </p>
            <div className="flex items-center gap-2">
              {folderReconnectNeeded ? (
                <Button
                  variant="primary"
                  onClick={() => void reconnectFolder()}
                >
                  {t("settings.storage.folderReconnect")}
                </Button>
              ) : folderConnected ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => void disconnectFolder()}
                  >
                    {t("common.disconnect")}
                  </Button>
                  <span className="text-xs text-accent">
                    {t("common.connected")}
                  </span>
                </>
              ) : (
                <Button variant="primary" onClick={() => void connectFolder()}>
                  {t("settings.storage.folderChoose")}
                </Button>
              )}
            </div>
          </div>
        )}

        {backend === "dropbox" && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted">
              {dropboxConnected
                ? t("settings.storage.dropboxConnected")
                : t("settings.storage.dropboxUnconnected")}
            </p>
            {dropboxConnected ? (
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={disconnectDropbox}>
                  {t("common.disconnect")}
                </Button>
                <span className="text-xs text-accent">
                  {t("common.connected")}
                </span>
              </div>
            ) : (
              <Button variant="primary" onClick={connectDropbox}>
                {t("common.connect")}
              </Button>
            )}
          </div>
        )}

        {backend === "gdrive" && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted">
              {gdriveConnected
                ? t("settings.storage.gdriveConnected")
                : t("settings.storage.gdriveUnconnected")}
            </p>
            {gdriveConnected ? (
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={disconnectGdrive}>
                  {t("common.disconnect")}
                </Button>
                <span className="text-xs text-accent">
                  {t("common.connected")}
                </span>
              </div>
            ) : (
              <Button
                variant="primary"
                onClick={() => void connectGdriveWithCapture()}
              >
                {t("common.connect")}
              </Button>
            )}
            {gdriveError && (
              <p
                role="alert"
                className="rounded-[var(--radius)] border border-danger/50 px-2 py-1.5 text-xs break-words text-danger"
              >
                {gdriveError}
              </p>
            )}
          </div>
        )}

        {backend === "notesd" && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted">
              {notesdConnected
                ? t("settings.storage.notesdConnected")
                : t("settings.storage.notesdUnconnected")}
            </p>
            {notesdConnected && !pairing ? (
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={unpairNotesd}>
                  {t("common.disconnect")}
                </Button>
                <span className="text-xs text-accent">
                  {t("common.connected")}
                </span>
              </div>
            ) : (
              <PairNotesdForm
                onPair={pairNotesd}
                onDone={() => setPairing(false)}
              />
            )}
          </div>
        )}
      </Section>

      <EncryptionSection
        encryption={encryption}
        conversion={conversion}
        onEnable={enableEncryption}
        onDisable={disableEncryption}
      />
    </>
  );
}

// The notesd pairing form: paste the `notesd://pair` code the daemon prints
// (or a QR-scanned value), validate it, redeem it, and switch to the backend.
// Paste-only for now; an in-app QR camera scan is a tracked follow-up.
function PairNotesdForm({
  onPair,
  onDone,
}: {
  onPair: (pairing: NotesdPairing) => Promise<void>;
  onDone: () => void;
}) {
  const t = useT();
  const [uri, setUri] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    let pairing: NotesdPairing;
    try {
      pairing = parsePairingUri(uri);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    setBusy(true);
    try {
      await onPair(pairing);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <p className="text-xs text-muted">
        {t("settings.storage.notesdPairHint")}
      </p>
      <textarea
        value={uri}
        onChange={(e) => setUri(e.target.value)}
        placeholder={t("settings.storage.notesdPairPlaceholder")}
        aria-label={t("settings.storage.notesdPair")}
        rows={2}
        className="rounded-[var(--radius)] border border-line bg-surface-2 px-2 py-1.5 font-mono text-xs break-all text-fg outline-none focus:border-accent"
      />
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={busy || !uri.trim()}>
          <BusyLabel busy={busy}>
            {t("settings.storage.notesdPairSubmit")}
          </BusyLabel>
        </Button>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius)] border border-danger/50 px-2 py-1.5 text-xs break-words text-danger"
        >
          {error}
        </p>
      )}
    </form>
  );
}

function EncryptionSection({
  encryption,
  conversion,
  onEnable,
  onDisable,
}: {
  encryption: "encrypted" | "plaintext";
  conversion: EncryptionConversionState;
  onEnable: (
    password: string,
    onProgress?: EncryptionProgress,
  ) => Promise<void>;
  onDisable: (onProgress?: EncryptionProgress) => Promise<void>;
}) {
  const t = useT();
  const on = encryption === "encrypted";
  const [setting, setSetting] = useState(false);
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  // Synchronous passphrase validation (too short / mismatch) shown inline under
  // the form. The asynchronous flow's own failures live in the status bar.
  const [validationError, setValidationError] = useState<string | null>(null);
  // True only while the toggle's own promise is in flight — the whole-document
  // re-save on the browser backend, or the brief mode flip on a file/cloud one.
  // Once it resolves, the `conversion` snapshot from the background queue drives
  // the status (the queue keeps sealing / decrypting after the modal closes).
  const [submitting, setSubmitting] = useState(false);
  // The phase line the browser backend flashes during its one-pass re-save.
  const [submitStep, setSubmitStep] = useState<string | null>(null);
  // A synchronous failure from the toggle itself (vs. the queue's, in
  // `conversion.error`). Stored as a log entry so its timestamp is captured when
  // it happens rather than recomputed during render.
  const [submitError, setSubmitError] = useState<EncryptionLogEntry | null>(
    null,
  );
  const [logOpen, setLogOpen] = useState(false);

  // The background queue is converting note-by-note (file/cloud); the modal can
  // be closed and it keeps going. `busy` folds in the toggle's own in-flight
  // promise so the spinner covers both.
  const queueBusy = conversion.busy;
  const busy = submitting || queueBusy;
  const errorText = submitError?.text ?? conversion.error;

  const statusMessage = queueBusy
    ? (conversion.message ??
      t(
        conversion.direction === "decrypt"
          ? "settings.storage.encryptionBusyDisabling"
          : "settings.storage.encryptionBusyEnabling",
      ))
    : (submitStep ?? null);

  const logEntries = useMemo<EncryptionLogEntry[]>(() => {
    if (conversion.log.length > 0) return conversion.log;
    if (submitError) return [submitError];
    return [];
  }, [conversion.log, submitError]);

  // Drive one turn-on / turn-off attempt: clear the status state, feed any phase
  // the browser path reports into the ticker, and park the error on a throw.
  const runToggle = async (
    op: (onProgress: EncryptionProgress) => Promise<void>,
  ): Promise<boolean> => {
    setSubmitting(true);
    setSubmitError(null);
    setSubmitStep(null);
    const onProgress: EncryptionProgress = (step) =>
      setSubmitStep(t(STEP_MESSAGE_KEY[step]));
    try {
      await op(onProgress);
      setSubmitStep(null);
      return true;
    } catch (err) {
      setSubmitError({
        text: err instanceof Error ? err.message : String(err),
        ts: Date.now(),
        level: "error",
      });
      setSubmitStep(null);
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const submitEnable = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (pass.length < 4) {
      setValidationError(t("settings.storage.passphraseTooShort"));
      return;
    }
    if (pass !== confirm) {
      setValidationError(t("settings.storage.passphraseMismatch"));
      return;
    }
    setValidationError(null);
    const ok = await runToggle((onProgress) => onEnable(pass, onProgress));
    if (ok) {
      setSetting(false);
      setPass("");
      setConfirm("");
    }
  };

  const disable = async () => {
    if (busy) return;
    await runToggle((onProgress) => onDisable(onProgress));
  };

  const inputClass =
    "rounded-[var(--radius)] border border-line bg-surface-2 px-2 py-1.5 text-sm text-fg outline-none focus:border-accent";

  return (
    <Section title={t("settings.storage.encryptionTitle")}>
      <div className="flex items-start gap-3">
        <ShieldIcon
          className={`mt-0.5 h-5 w-5 ${on ? "text-accent" : "text-muted"}`}
        />
        <div className="flex-1">
          <h3 className="text-sm font-bold text-fg-bright">
            {on
              ? t("settings.storage.encryptionOn")
              : t("settings.storage.encryptionOff")}
          </h3>
          <p className="mt-1 text-xs text-muted">
            {t("settings.storage.encryptionHint")}
          </p>
        </div>
      </div>

      {!on && !setting && (
        <Button variant="primary" onClick={() => setSetting(true)}>
          {t("settings.storage.enableEncryption")}
        </Button>
      )}

      {!on && setting && (
        <form onSubmit={submitEnable} className="flex flex-col gap-2">
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            onFocus={(e) => scrollFocusedIntoView(e.currentTarget)}
            placeholder={t("settings.storage.passphrase")}
            aria-label={t("settings.storage.passphrase")}
            disabled={busy}
            className={inputClass}
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onFocus={(e) => scrollFocusedIntoView(e.currentTarget)}
            placeholder={t("settings.storage.passphraseConfirm")}
            aria-label={t("settings.storage.passphraseConfirm")}
            disabled={busy}
            className={inputClass}
          />
          <p className="text-xs text-danger">
            {t("settings.storage.passphraseWarning")}
          </p>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              <BusyLabel busy={busy}>
                {t("settings.storage.enableEncryption")}
              </BusyLabel>
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setSetting(false);
                setValidationError(null);
                setSubmitError(null);
                setPass("");
                setConfirm("");
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      )}

      {on && (
        <Button variant="danger" onClick={() => void disable()} disabled={busy}>
          <BusyLabel busy={busy}>
            {t("settings.storage.disableEncryption")}
          </BusyLabel>
        </Button>
      )}

      {busy && statusMessage && (
        <div
          role="status"
          aria-label={t("settings.storage.encryptionStatusAria")}
          className="flex flex-col gap-1 rounded-[var(--radius)] border border-line bg-surface-2 px-2.5 py-1.5"
        >
          <div className="flex items-center gap-2">
            <CipherGlyph className="shrink-0 text-xs text-accent" />
            <span className="truncate text-xs text-muted">{statusMessage}</span>
          </div>
          {queueBusy && (
            <span className="text-xs text-accent">
              {t("settings.storage.conversionCanClose")}
            </span>
          )}
        </div>
      )}

      {!busy && errorText && (
        <button
          type="button"
          onClick={() => setLogOpen(true)}
          className="flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius)] border border-danger/50 bg-danger/10 px-2.5 py-1.5 text-left hover:bg-danger/20"
        >
          <span className="truncate text-xs text-danger">
            {t("settings.storage.encryptionFailed")}
          </span>
        </button>
      )}

      {validationError && (
        <p role="alert" className="text-xs text-danger">
          {validationError}
        </p>
      )}

      <EncryptionLogModal
        open={logOpen}
        entries={logEntries}
        onClose={() => setLogOpen(false)}
      />
    </Section>
  );
}
