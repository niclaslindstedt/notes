import {
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { useT, type TFunction } from "../i18n/index.ts";
import type { SaveStatus } from "../app/use-notes-sync.ts";
import type { BackendId } from "../storage/backend-preference.ts";
import {
  getLogs,
  subscribeToLogs,
  type LogEntry,
  type LogLevel,
} from "../dev/logger.ts";
import { DROPBOX_APP_FOLDER, dropboxWebUrl } from "../storage/dropbox/index.ts";
import {
  GDRIVE_APP_FOLDER_NAME,
  gdriveWebUrl,
} from "../storage/gdrive/index.ts";
import { namespaceNotesFolder } from "../storage/namespaces.ts";
import { Button } from "./form/Button.tsx";
import type { EncryptionConversionState } from "./settings/EncryptionLogModal.tsx";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  CloudAlertIcon,
  CloudCheckIcon,
  CloudIcon,
  CloudOffIcon,
  CloudUploadIcon,
  ExternalLinkIcon,
  FolderIcon,
  LockIcon,
  NoteIcon,
  RefreshIcon,
  ScrollTextIcon,
  ShieldIcon,
  SpinnerIcon,
} from "./icons.tsx";
import { Modal } from "./Modal.tsx";

// Cloud-sync command centre, ported from checklist's `SyncDetailsModal` and
// grown into the one place that answers "what is sync doing right now". The
// header sync glyph always opens it (whatever the state), and it lays out, in
// columns: the headline status and *why* a save failed; the live activity —
// which note files are uploading this second and the background encryption
// conversion's per-note / per-attachment progress; the backend, its at-rest
// encryption state, and the on-disk file location; and an inline, always-on
// sync log (read straight from the in-memory ring buffer, so it shows even when
// the developer-mode capture toggle is off). Buttons carry glyphs and a
// Reconnect / Save now / Reload escape hatch, with a link out to the backend's
// web UI.

type UploadItem = { id: string; title: string };

type Props = {
  open: boolean;
  backend: BackendId;
  namespace: string;
  providerName: string;
  status: SaveStatus;
  statusDetail: string | null;
  dirty: boolean;
  /** True when the backend is unreachable and we're on the on-device copy. */
  offline: boolean;
  /** True when the active backend writes encrypted at rest. */
  encrypted?: boolean;
  /** Notes whose file is being written to the backend this second. */
  uploads?: readonly UploadItem[];
  /** Live snapshot of the background encrypt/decrypt conversion. */
  conversion?: EncryptionConversionState;
  onSaveNow: () => void;
  /** Re-read the document from the backend, replacing what's on screen. */
  onReload: () => void;
  // Re-issue the backend grant (OAuth for the clouds, the OS folder permission
  // for the picked folder). Resolves on success and throws on failure so the
  // inline button can spin while the popup / redirect runs and surface the
  // failure instead of swallowing it.
  onReconnect: () => Promise<void>;
  onClose: () => void;
};

type IconComponent = (props: { className?: string }) => ReactElement;

type Tone = "ok" | "busy" | "warn" | "err" | "push";

type ProviderView = {
  /** Human-readable path the user sees when browsing the backend. */
  path: string;
  /** Web UI URL for the backend, or null when it can't be opened in a tab. */
  url: string | null;
};

// The logger scopes that make up the cloud-sync story. The Sync log section
// only surfaces these, so a reader sees the round-trip — auth, the per-note
// save, retries, the offline mirror, the encryption conversion — without the
// unrelated noise (seeding, tests) that also flows through the shared buffer.
const SYNC_LOG_SCOPES: ReadonlySet<string> = new Set([
  "notes-sync",
  "dropbox",
  "gdrive",
  "folder",
  "folder-handle",
  "cache",
  "oauth",
  "migration",
  "encrypt",
  "storage",
  "serialize",
  "migrate",
  "namespaces",
  "backend-pref",
]);

function providerView(backend: BackendId, namespace: string): ProviderView {
  const notesFolder = namespaceNotesFolder(namespace);
  if (backend === "dropbox") {
    return {
      path: `Apps/${DROPBOX_APP_FOLDER}/${notesFolder}`,
      url: dropboxWebUrl(namespace),
    };
  }
  if (backend === "gdrive") {
    return {
      path: `My Drive/${GDRIVE_APP_FOLDER_NAME}/${notesFolder}`,
      // Drive home — the folder id isn't threaded here, so the user scrolls to
      // the folder from My Drive.
      url: gdriveWebUrl(null),
    };
  }
  // Picked folder: no web URL, and the OS path isn't exposed to the app.
  return { path: notesFolder, url: null };
}

// The glyph that names the backend family in the Details grid: a cloud for the
// hosted backends, a folder for the picked directory.
function backendGlyph(backend: BackendId): ReactElement {
  const className = "h-3.5 w-3.5 shrink-0 text-muted";
  return backend === "folder" ? (
    <FolderIcon className={className} />
  ) : (
    <CloudIcon className={className} />
  );
}

type StatusView = {
  Icon: IconComponent;
  label: string;
  tone: Tone;
  detail?: string;
  spin?: boolean;
};

function statusView(
  t: TFunction,
  status: SaveStatus,
  statusDetail: string | null,
  dirty: boolean,
  offline: boolean,
  providerName: string,
): StatusView {
  // Offline takes precedence (see `SyncStatus`): explain that the user is on a
  // local copy that re-syncs on reconnect, rather than implying a sync.
  if (offline) {
    return {
      Icon: CloudOffIcon,
      label: t("sync.offlineHeading"),
      tone: "warn",
      detail: t("sync.offlineDetail", { provider: providerName }),
    };
  }
  switch (status) {
    case "saving":
      return {
        Icon: SpinnerIcon,
        label: t("sync.syncingNow"),
        tone: "busy",
        spin: true,
      };
    case "error":
      return {
        Icon: CloudAlertIcon,
        label: t("sync.failedHeading"),
        tone: "err",
        detail:
          statusDetail ??
          t("sync.failedDetailFallback", { provider: providerName }),
      };
    case "throttled":
      return {
        Icon: CloudAlertIcon,
        label: t("sync.throttledHeading"),
        tone: "warn",
        detail: t("sync.throttledDetail", { provider: providerName }),
      };
    case "auth-error":
      return {
        Icon: CloudAlertIcon,
        label: t("sync.reauthHeading"),
        tone: "err",
        detail: t("sync.reauthDetail", { provider: providerName }),
      };
    case "conflict":
      return {
        Icon: CloudAlertIcon,
        label: t("sync.conflictHeading"),
        tone: "err",
        detail: t("sync.conflictDetail"),
      };
    case "saved":
    case "idle":
      return dirty
        ? {
            Icon: CloudUploadIcon,
            label: t("sync.pendingHeading"),
            tone: "push",
            detail: t("sync.pendingDetail", { provider: providerName }),
          }
        : {
            Icon: CloudCheckIcon,
            label: t("sync.syncedHeading", { provider: providerName }),
            tone: "ok",
          };
  }
}

const TONE_BORDER: Record<Tone, string> = {
  ok: "border-accent/40 bg-accent/5",
  busy: "border-line bg-surface-2",
  warn: "border-link/50 bg-link/5",
  err: "border-danger/50 bg-danger/5",
  push: "border-link bg-link/10",
};

const TONE_TEXT: Record<Tone, string> = {
  ok: "text-accent",
  busy: "text-muted",
  warn: "text-link",
  err: "text-danger",
  push: "text-link",
};

export function SyncDetailsModal({
  open,
  backend,
  namespace,
  providerName,
  status,
  statusDetail,
  dirty,
  offline,
  encrypted = false,
  uploads = [],
  conversion,
  onSaveNow,
  onReload,
  onReconnect,
  onClose,
}: Props) {
  const t = useT();
  const titleId = useId();
  const [reconnectPending, setReconnectPending] = useState(false);
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  // Reset the inline reconnect state whenever the modal closes or the session
  // leaves the auth-error state, so a stale spinner / error never greets a
  // later open.
  useEffect(() => {
    if (!open) {
      setReconnectPending(false);
      setReconnectError(null);
    }
  }, [open]);
  useEffect(() => {
    if (status !== "auth-error") setReconnectError(null);
  }, [status]);

  const view = providerView(backend, namespace);
  // The "Open in …" link names the destination service itself — Dropbox,
  // Google Drive — not the at-rest encryption state. `providerName` is the
  // adapter label, which the encryption wrapper suffixes with " (encrypted)";
  // strip that so the button reads "Open in Dropbox", not
  // "Open in Dropbox (encrypted)".
  const baseProviderName = providerName.replace(/\s*\(encrypted\)$/, "");
  // The status copy names the destination service, not its at-rest state — the
  // Details grid carries the encryption indicator now — so feed it the bare
  // name ("Synced to Dropbox", not "Synced to Dropbox (encrypted)").
  const state = statusView(
    t,
    status,
    statusDetail,
    dirty,
    offline,
    baseProviderName,
  );
  const busy = status === "saving";
  const showReconnect = status === "auth-error";

  const handleReconnect = async () => {
    if (reconnectPending) return;
    setReconnectPending(true);
    setReconnectError(null);
    try {
      await onReconnect();
    } catch (err) {
      setReconnectError(err instanceof Error ? err.message : String(err));
    } finally {
      setReconnectPending(false);
    }
  };

  const showSaveNow =
    !busy &&
    !showReconnect &&
    (status === "error" || (dirty && status !== "conflict"));
  const saveLabel =
    status === "error" ? t("common.tryAgain") : t("sync.saveNow");

  const reconnectLabel =
    reconnectError !== null
      ? t("common.tryAgain")
      : t("sync.reconnectTo", { provider: providerName });
  const ReconnectIcon: IconComponent = reconnectPending
    ? SpinnerIcon
    : RefreshIcon;

  const converting = conversion?.busy ?? false;
  const conversionError = conversion?.error ?? null;
  const hasActivity =
    uploads.length > 0 || converting || conversionError !== null;

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} centered>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-surface-3 px-4 py-3">
        <h2
          id={titleId}
          className="flex items-center gap-2 text-sm font-bold tracking-wide text-fg-bright"
        >
          <CloudIcon className="h-4 w-4" />
          {t("sync.cloudSync")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="-mr-1 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[var(--radius)] text-muted hover:bg-surface-2 hover:text-fg"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4">
        {/* Headline status — what sync is doing and, on failure, why. */}
        <section className="flex flex-col gap-2">
          <SectionLabel>{t("sync.status")}</SectionLabel>
          <div
            className={`flex items-start gap-2 rounded-[var(--radius)] border px-2.5 py-2 ${TONE_BORDER[state.tone]}`}
          >
            <state.Icon
              className={`mt-0.5 h-4 w-4 shrink-0 ${TONE_TEXT[state.tone]} ${
                state.spin ? "animate-spin" : ""
              }`}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className={`text-sm font-bold ${TONE_TEXT[state.tone]}`}>
                {state.label}
              </span>
              {state.detail && (
                <p className="text-xs break-words whitespace-pre-wrap text-fg">
                  {state.detail}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {showReconnect && (
              <button
                type="button"
                onClick={handleReconnect}
                disabled={reconnectPending}
                aria-busy={reconnectPending || undefined}
                className={`inline-flex items-center justify-center gap-1.5 rounded-[var(--radius)] border border-accent bg-accent/10 px-3 py-1.5 text-sm font-bold text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-70 ${
                  reconnectPending ? "" : "cursor-pointer"
                }`}
              >
                <ReconnectIcon
                  className={`h-3.5 w-3.5 ${reconnectPending ? "animate-spin" : ""}`}
                />
                {reconnectLabel}
              </button>
            )}

            {showSaveNow && (
              <button
                type="button"
                onClick={onSaveNow}
                className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius)] border border-accent bg-accent/10 px-3 py-1.5 text-sm font-bold text-accent hover:bg-accent/20"
              >
                <CloudUploadIcon className="h-3.5 w-3.5" />
                {saveLabel}
              </button>
            )}

            <Button variant="secondary" onClick={onReload}>
              <span className="inline-flex items-center gap-1.5">
                <RefreshIcon className="h-3.5 w-3.5" />
                {t("sync.reloadFromBackend")}
              </span>
            </Button>
          </div>

          {reconnectError && (
            <p className="text-xs break-words text-danger">{reconnectError}</p>
          )}
        </section>

        {/* Live activity — files uploading and the encryption conversion. */}
        {hasActivity && (
          <section className="flex flex-col gap-2">
            <SectionLabel>{t("sync.activity")}</SectionLabel>
            <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-line bg-surface-2 px-2.5 py-2">
              {uploads.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <CloudUploadIcon className="h-3.5 w-3.5 shrink-0 text-link" />
                    <span className="text-xs font-bold text-link">
                      {t("sync.uploadingFiles")}
                    </span>
                    <span className="text-xs text-muted">
                      {t("sync.uploadingCount", { n: uploads.length })}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-1 pl-1">
                    {uploads.map((u) => (
                      <li
                        key={u.id}
                        className="flex items-center gap-2 text-xs text-fg"
                      >
                        <SpinnerIcon className="h-3 w-3 shrink-0 animate-spin text-muted" />
                        <NoteIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
                        <span className="truncate">{u.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {converting && conversion && (
                <ConversionRow t={t} conversion={conversion} />
              )}

              {!converting && conversionError && (
                <div className="flex items-start gap-2">
                  <ShieldIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-xs font-bold text-danger">
                      {t("sync.conversionFailed")}
                    </span>
                    <span className="text-xs break-words whitespace-pre-wrap text-fg">
                      {conversionError}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Backend + encryption side by side, then the file location. */}
        <section className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <Detail label={t("sync.backend")} icon={backendGlyph(backend)}>
              <span className="truncate text-sm text-fg-bright">
                {baseProviderName}
              </span>
            </Detail>
            <Detail
              label={t("sync.encryptionLabel")}
              icon={
                encrypted ? (
                  <LockIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
                ) : (
                  <ShieldIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
                )
              }
            >
              <span
                className={`text-sm font-bold ${encrypted ? "text-accent" : "text-muted"}`}
              >
                {encrypted ? t("sync.encryptionOn") : t("sync.encryptionOff")}
              </span>
            </Detail>
          </div>

          <div className="flex flex-col gap-1">
            <SectionLabel>{t("sync.fileLocation")}</SectionLabel>
            <span className="rounded-[var(--radius)] border border-line bg-surface-2 px-2 py-1.5 font-mono text-xs break-all text-fg">
              {view.path}
            </span>
          </div>
        </section>

        {/* Always-on sync log — works even with capture disabled. */}
        <section className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setLogOpen((v) => !v)}
            aria-expanded={logOpen}
            className="flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius)] border border-line bg-surface-2 px-2.5 py-1.5 text-left hover:border-accent"
          >
            <ScrollTextIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
            <span className="flex-1 text-xs font-bold text-fg">
              {logOpen ? t("sync.hideSyncLog") : t("sync.viewSyncLog")}
            </span>
            {logOpen ? (
              <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted" />
            ) : (
              <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" />
            )}
          </button>
          {logOpen && <SyncLogPanel t={t} />}
        </section>
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface-3 px-4 py-3">
        <Button variant="secondary" onClick={onClose}>
          {t("common.close")}
        </Button>
        {view.url && (
          <a
            href={view.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius)] border border-accent bg-accent/10 px-3 py-1.5 text-sm font-bold text-accent hover:bg-accent/20"
          >
            <ExternalLinkIcon className="h-3.5 w-3.5" />
            {t("sync.openIn", { provider: baseProviderName })}
          </a>
        )}
      </footer>
    </Modal>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs font-bold tracking-wide text-muted uppercase">
      {children}
    </span>
  );
}

function Detail({
  label,
  icon,
  children,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius)] border border-line bg-surface-2 px-2.5 py-2">
      <span className="text-[0.65rem] font-bold tracking-wide text-muted uppercase">
        {label}
      </span>
      <div className="flex min-w-0 items-center gap-1.5">
        {icon}
        {children}
      </div>
    </div>
  );
}

// The background encrypt/decrypt conversion as a live progress row: a heading,
// the running count, a fill bar, and the per-note / per-attachment message the
// migration hook surfaces.
function ConversionRow({
  t,
  conversion,
}: {
  t: TFunction;
  conversion: EncryptionConversionState;
}) {
  const decrypting = conversion.direction === "decrypt";
  const pct =
    conversion.total > 0
      ? Math.min(100, Math.round((conversion.done / conversion.total) * 100))
      : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <LockIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="text-xs font-bold text-accent">
          {decrypting
            ? t("sync.decryptingHeading")
            : t("sync.encryptingHeading")}
        </span>
        {conversion.total > 0 && (
          <span className="ml-auto text-xs text-muted tabular-nums">
            {t("sync.conversionCount", {
              done: conversion.done,
              total: conversion.total,
            })}
          </span>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      {conversion.message && (
        <span className="flex items-center gap-2 text-xs text-muted">
          <SpinnerIcon className="h-3 w-3 shrink-0 animate-spin" />
          <span className="truncate">{conversion.message}</span>
        </span>
      )}
    </div>
  );
}

// The inline sync log. Reads the in-memory ring buffer directly (the same
// buffer the Logs settings tab shows) so a sync issue is legible here even when
// the developer-mode capture toggle — which only governs persistence across
// reloads — is off. Subscribes only while expanded.
function SyncLogPanel({ t }: { t: TFunction }) {
  const [version, setVersion] = useState(0);
  const [copyStatus, setCopyStatus] = useState<null | "copied" | "failed">(
    null,
  );

  useEffect(() => subscribeToLogs(() => setVersion((v) => v + 1)), []);

  // `version` ticks on every logger push / clear, forcing a re-read of the
  // ring buffer; the filter narrows it to the cloud-sync scopes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => getLogs(), [version]);
  const entries = useMemo(
    () => all.filter((e) => SYNC_LOG_SCOPES.has(e.scope)),
    [all],
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(
        entries.map(formatLogLine).join("\n"),
      );
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
    setTimeout(() => setCopyStatus(null), 2000);
  }

  if (entries.length === 0) {
    return (
      <p className="rounded-[var(--radius)] border border-line bg-surface-2 px-2.5 py-2 text-xs text-muted">
        {t("sync.syncLogEmpty")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={handleCopy}
          className="cursor-pointer rounded border border-line px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-accent"
        >
          {copyStatus === "copied"
            ? t("sync.copied")
            : copyStatus === "failed"
              ? t("sync.copyFailed")
              : t("sync.copyLog")}
        </button>
      </div>
      <ul className="flex max-h-44 flex-col overflow-y-auto rounded border border-line bg-surface-2 font-mono text-xs">
        {entries.map((entry, idx) => (
          <li
            key={`${entry.ts}-${idx}`}
            className={`flex flex-col gap-0.5 border-b border-l-2 border-line px-2.5 py-1.5 last:border-b-0 ${railClass(
              entry.level,
            )}`}
          >
            <span className="flex flex-wrap items-baseline gap-2">
              <span className="text-muted tabular-nums">
                {formatLogTime(entry.ts)}
              </span>
              <span className={levelClass(entry.level)}>
                {entry.level.toUpperCase()}
              </span>
              <span className="text-accent">[{entry.scope}]</span>
            </span>
            <span className="break-words whitespace-pre-wrap text-fg">
              {entry.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatLogTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatLogLine(entry: LogEntry): string {
  return `${formatLogTime(entry.ts)} [${entry.scope}] ${entry.level.toUpperCase()} ${entry.message}`;
}

function levelClass(level: LogLevel): string {
  switch (level) {
    case "error":
      return "text-danger";
    case "warn":
      return "text-link";
    case "info":
      return "text-muted";
  }
}

function railClass(level: LogLevel): string {
  switch (level) {
    case "error":
      return "border-l-danger";
    case "warn":
      return "border-l-link";
    case "info":
      return "border-l-accent";
  }
}
