import { useEffect, useId, useState, type ReactElement } from "react";

import type { SaveStatus } from "../app/use-notes-sync.ts";
import type { BackendId } from "../storage/backend-preference.ts";
import { DROPBOX_APP_FOLDER, dropboxWebUrl } from "../storage/dropbox/index.ts";
import {
  GDRIVE_APP_FOLDER_NAME,
  gdriveWebUrl,
} from "../storage/gdrive/index.ts";
import { namespaceCloudFolder } from "../storage/namespaces.ts";
import { Button } from "./form/Button.tsx";
import {
  CloseIcon,
  CloudAlertIcon,
  CloudCheckIcon,
  CloudIcon,
  CloudOffIcon,
  CloudUploadIcon,
  ExternalLinkIcon,
  RefreshIcon,
  SpinnerIcon,
} from "./icons.tsx";
import { Modal } from "./Modal.tsx";

// Cloud-sync details modal, ported from checklist's `SyncDetailsModal`. The
// header sync glyph opens it; it spells out what the sync is doing and —
// crucially — *why* it failed, so a broken save is no longer a silent red
// icon the user can't act on. Carries the failure reason verbatim, a Reconnect
// button when the session lapsed, a Save now / Try again button, a Reload from
// backend escape hatch, and the backend's file location with a link out to its
// web UI.

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

function providerView(backend: BackendId, namespace: string): ProviderView {
  const folder = namespaceCloudFolder(namespace);
  const suffix = folder ? `/${folder}` : "";
  if (backend === "dropbox") {
    return {
      path: `Apps/${DROPBOX_APP_FOLDER}${suffix}`,
      url: dropboxWebUrl(namespace),
    };
  }
  if (backend === "gdrive") {
    return {
      path: `My Drive/${GDRIVE_APP_FOLDER_NAME}${suffix}`,
      // Drive home — the folder id isn't threaded here, so the user scrolls to
      // the folder from My Drive.
      url: gdriveWebUrl(null),
    };
  }
  // Picked folder: no web URL, and the OS path isn't exposed to the app.
  return { path: folder || "the folder you picked", url: null };
}

type StatusView = {
  Icon: IconComponent;
  label: string;
  tone: Tone;
  detail?: string;
  spin?: boolean;
};

function statusView(
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
      label: "You're offline",
      tone: "warn",
      detail: `You're editing the copy saved on this device. It'll sync back to ${providerName} when the connection returns.`,
    };
  }
  switch (status) {
    case "saving":
      return {
        Icon: SpinnerIcon,
        label: "Syncing now…",
        tone: "busy",
        spin: true,
      };
    case "error":
      return {
        Icon: CloudAlertIcon,
        label: "Sync failed",
        tone: "err",
        detail:
          statusDetail ?? `The last save to ${providerName} didn't go through.`,
      };
    case "throttled":
      return {
        Icon: CloudAlertIcon,
        label: "Rate limited",
        tone: "warn",
        detail: `${providerName} is throttling saves. Your latest changes will sync automatically in a moment.`,
      };
    case "auth-error":
      return {
        Icon: CloudAlertIcon,
        label: "Reconnect needed",
        tone: "err",
        detail: `Your connection to ${providerName} expired. Reconnect to keep syncing.`,
      };
    case "conflict":
      return {
        Icon: CloudAlertIcon,
        label: "Sync conflict",
        tone: "err",
        detail: `Another device changed these notes. Choose which copy to keep in the conflict prompt.`,
      };
    case "saved":
    case "idle":
      return dirty
        ? {
            Icon: CloudUploadIcon,
            label: "Unsaved changes",
            tone: "push",
            detail: `You have changes that haven't been saved to ${providerName} yet.`,
          }
        : {
            Icon: CloudCheckIcon,
            label: `Synced to ${providerName}`,
            tone: "ok",
          };
  }
}

const TONE_BORDER: Record<Tone, string> = {
  ok: "border-accent/40",
  busy: "border-line",
  warn: "border-link/50",
  err: "border-danger/50",
  push: "border-link",
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
  onSaveNow,
  onReload,
  onReconnect,
  onClose,
}: Props) {
  const titleId = useId();
  const [reconnectPending, setReconnectPending] = useState(false);
  const [reconnectError, setReconnectError] = useState<string | null>(null);

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
  const state = statusView(status, statusDetail, dirty, offline, providerName);
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
  const saveLabel = status === "error" ? "Try again" : "Save now";

  const reconnectLabel =
    reconnectError !== null ? "Try again" : `Reconnect to ${providerName}`;
  const ReconnectIcon: IconComponent = reconnectPending
    ? SpinnerIcon
    : RefreshIcon;

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId}>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-surface-3 px-4 py-3">
        <h2
          id={titleId}
          className="flex items-center gap-2 text-sm font-bold tracking-wide text-fg-bright"
        >
          <CloudIcon className="h-4 w-4" />
          Cloud sync
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[var(--radius)] text-muted hover:bg-surface-2 hover:text-fg"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4">
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted">Status</span>
          <div
            className={`flex items-start gap-2 rounded-[var(--radius)] border px-2 py-2 ${TONE_BORDER[state.tone]}`}
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
              Reload from backend
            </Button>
          </div>

          {reconnectError && (
            <p className="text-xs break-words text-danger">{reconnectError}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">Backend</span>
          <span className="text-sm text-fg-bright">{providerName}</span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">File location</span>
          <span className="rounded-[var(--radius)] border border-line bg-surface-2 px-2 py-1.5 font-mono text-xs break-all text-fg">
            {view.path}
          </span>
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface-3 px-4 py-3">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        {view.url && (
          <a
            href={view.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius)] border border-accent bg-accent/10 px-3 py-1.5 text-sm font-bold text-accent hover:bg-accent/20"
          >
            <ExternalLinkIcon className="h-3.5 w-3.5" />
            Open in {providerName}
          </a>
        )}
      </footer>
    </Modal>
  );
}
