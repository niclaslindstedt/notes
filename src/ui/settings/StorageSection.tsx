import { useMemo, useState, type FormEvent } from "react";

import { useT } from "../../i18n/index.ts";
import type { BackendId } from "../../storage/backend-preference.ts";
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
import { NamespacePinSection } from "./NamespacePinSection.tsx";
import { NextcloudConnectForm } from "./NextcloudConnectForm.tsx";
import { ICLOUD_FOLDER_NAME } from "../../storage/icloud/constants.ts";
import { Section } from "./shared.tsx";

// Storage settings: pick the backend that persists the notes (this device /
// local folder / Dropbox) and toggle at-rest encryption.
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
    dropboxAvailable,
    dropboxConnected,
    folderAvailable,
    folderConnected,
    folderReconnectNeeded,
    icloudAvailable,
    icloudStatus,
    icloudConnected,
    connectICloud,
    disconnectICloud,
    nextcloudConnected,
    nextcloudConfig,
    connectNextcloud,
    disconnectNextcloud,
    encryption,
    selectBrowser,
    connectFolder,
    reconnectFolder,
    disconnectFolder,
    connectDropbox,
    disconnectDropbox,
    enableEncryption,
    disableEncryption,
    namespaces,
    activeNamespace,
  } = storage;

  // Encryption is a per-namespace decision, so the section names the namespace
  // it is about rather than talking about "your notes" in general.
  const activeNamespaceName =
    namespaces.find((n) => n.slug === activeNamespace)?.name ?? activeNamespace;

  // Dropbox only reports anything here on the desktop. On the web the connect
  // navigates away, so there is no failure left to show and no wait to sit
  // through; on the desktop the sign-in happens in the user's browser and this
  // panel is what's left on screen while it does.
  const [dropboxError, setDropboxError] = useState<string | null>(null);
  const [dropboxPending, setDropboxPending] = useState(false);
  // Picking Nextcloud with nothing stored reveals the connect form, and "Change server" brings it back with the stored values prefilled.
  const [editingNextcloud, setEditingNextcloud] = useState(false);
  // True while an iCloud connect or re-check is asking the host.
  const [icloudPending, setICloudPending] = useState(false);
  // Picking iCloud on a device signed out of iCloud leaves the backend where it
  // was, so the panel that explains why is shown on the pick, not the backend.
  const [icloudPicked, setICloudPicked] = useState(false);

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
      disabled: !dropboxAvailable,
    },
    // iCloud Drive is offered wherever a host provides it — the iOS app does,
    // a browser never can. The page asks whether the capability is there, not
    // where it is running, so the option simply isn't listed elsewhere.
    ...(icloudAvailable
      ? [
          {
            value: "icloud" as const,
            label: t("settings.storage.backendICloud"),
          },
        ]
      : []),
    // Nextcloud needs no build-time key and no OAuth redirect — it is a server
    // the user runs, reached with credentials they paste — so it is offered on
    // every surface.
    {
      value: "nextcloud",
      label: t("settings.storage.backendNextcloud"),
    },
  ];

  const connectDropboxWithCapture = async () => {
    setDropboxError(null);
    setDropboxPending(true);
    try {
      await connectDropbox();
    } catch (err) {
      setDropboxError(err instanceof Error ? err.message : String(err));
    } finally {
      setDropboxPending(false);
    }
  };

  // Connect iCloud Drive — which re-checks the container first, so it is also
  // the "Check again" after signing in to iCloud. A container that still can't
  // be reached is not an error to show verbatim: the status it leaves behind
  // drives the translated hint below.
  const connectICloudWithStatus = async () => {
    setICloudPending(true);
    try {
      await connectICloud();
    } catch {
      // `icloudStatus` now says why; the panel shows it.
    } finally {
      setICloudPending(false);
    }
  };

  const onPickBackend = (next: BackendId) => {
    setDropboxError(null);
    setICloudPicked(next === "icloud");
    if (next === backend) return;
    if (next === "browser") selectBrowser();
    else if (next === "folder") void connectFolder();
    else if (next === "dropbox") void connectDropboxWithCapture();
    // iCloud needs nothing from the user — the container is the app's own and
    // the device's Apple Account opens it — so picking it connects at once.
    else if (next === "icloud") void connectICloudWithStatus();
    // Nextcloud doesn't auto-connect on pick either: with nothing stored it
    // reveals the connect form, and only switches backend once the server has
    // accepted the credentials.
    else if (next === "nextcloud") setEditingNextcloud(!nextcloudConnected);
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
                : dropboxPending
                  ? t("settings.storage.dropboxWaiting")
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
              <Button
                variant="primary"
                disabled={dropboxPending}
                onClick={() => void connectDropboxWithCapture()}
              >
                <BusyLabel busy={dropboxPending}>
                  {t("common.connect")}
                </BusyLabel>
              </Button>
            )}
            {dropboxError && (
              <p
                role="alert"
                className="rounded-[var(--radius)] border border-danger/50 px-2 py-1.5 text-xs break-words text-danger"
              >
                {dropboxError}
              </p>
            )}
          </div>
        )}

        {icloudAvailable && (backend === "icloud" || icloudPicked) && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted">
              {icloudConnected
                ? t("settings.storage.icloudConnected", {
                    folder: ICLOUD_FOLDER_NAME,
                  })
                : icloudStatus === "signed-out"
                  ? t("settings.storage.icloudSignedOut")
                  : t("settings.storage.icloudUnconnected")}
            </p>
            {icloudConnected ? (
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={disconnectICloud}>
                  {t("common.disconnect")}
                </Button>
                <span className="text-xs text-accent">
                  {t("common.connected")}
                </span>
              </div>
            ) : (
              <Button
                variant="primary"
                disabled={icloudPending}
                onClick={() => void connectICloudWithStatus()}
              >
                <BusyLabel busy={icloudPending}>
                  {icloudStatus === "signed-out"
                    ? t("settings.storage.icloudCheckAgain")
                    : t("common.connect")}
                </BusyLabel>
              </Button>
            )}
          </div>
        )}

        {backend === "nextcloud" && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted">
              {nextcloudConnected && nextcloudConfig
                ? t("settings.storage.nextcloudConnected", {
                    folder: nextcloudConfig.folder,
                    server: nextcloudConfig.endpoint.replace(
                      /^https?:\/\//,
                      "",
                    ),
                  })
                : t("settings.storage.nextcloudUnconnected")}
            </p>
            {nextcloudConnected && !editingNextcloud ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setEditingNextcloud(true)}
                >
                  {t("common.change")}
                </Button>
                <Button variant="secondary" onClick={disconnectNextcloud}>
                  {t("common.disconnect")}
                </Button>
                <span className="text-xs text-accent">
                  {t("common.connected")}
                </span>
              </div>
            ) : (
              <NextcloudConnectForm
                initial={
                  nextcloudConfig
                    ? {
                        server: nextcloudConfig.endpoint,
                        username: nextcloudConfig.username,
                        folder: nextcloudConfig.folder,
                      }
                    : undefined
                }
                onConnect={async (request) => {
                  await connectNextcloud(request);
                  setEditingNextcloud(false);
                }}
              />
            )}
          </div>
        )}
      </Section>

      <NamespacePinSection storage={storage} />

      <EncryptionSection
        encryption={encryption}
        namespace={activeNamespaceName}
        conversion={conversion}
        onEnable={enableEncryption}
        onDisable={disableEncryption}
      />
    </>
  );
}

function EncryptionSection({
  encryption,
  namespace,
  conversion,
  onEnable,
  onDisable,
}: {
  encryption: "encrypted" | "plaintext";
  /**
   * The active namespace's display name. Encryption is a per-namespace
   * decision, so every line here says *which* namespace is being sealed —
   * without it, "Encryption is on" reads as a statement about the whole app
   * and the next namespace you open contradicts it.
   */
  namespace: string;
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
              ? t("settings.storage.encryptionOn", { namespace })
              : t("settings.storage.encryptionOff", { namespace })}
          </h3>
          <p className="mt-1 text-xs text-muted">
            {t("settings.storage.encryptionHint", { namespace })}
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
            onChange={(e) => setPass(e.currentTarget.value)}
            onFocus={(e) => scrollFocusedIntoView(e.currentTarget)}
            placeholder={t("settings.storage.passphrase")}
            aria-label={t("settings.storage.passphrase")}
            disabled={busy}
            className={inputClass}
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.currentTarget.value)}
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
