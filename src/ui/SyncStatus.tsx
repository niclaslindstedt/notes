import type { ReactElement } from "react";

import { useT, type TFunction } from "../i18n/index.ts";
import type { SaveStatus } from "../app/use-notes-sync.ts";
import {
  CloudAlertIcon,
  CloudCheckIcon,
  CloudOffIcon,
  CloudUploadIcon,
  SpinnerIcon,
} from "./icons.tsx";

// Single header affordance for cloud / folder-backed sessions, ported from
// checklist's `SyncStatus`. One glyph that morphs with state: a cloud-upload
// (link ring) when there are unsaved edits to push, a spinner while a save is
// in flight, a green cloud-check when the backend is in sync, and a coloured
// cloud-alert for conflict / auth / throttle / generic errors. Whatever the
// state, tapping it opens the sync-details modal — the command centre where the
// status is spelled out and Save now / Reconnect / Reload live — so the glyph
// stays a single, predictable way in even mid-save.

type Props = {
  providerName: string;
  status: SaveStatus;
  dirty: boolean;
  /** True when the backend is unreachable and we're on the on-device copy. */
  offline: boolean;
  onOpenDetails: () => void;
};

type IconComponent = (props: { className?: string }) => ReactElement;

type Tone = "ok" | "busy" | "warn" | "err" | "push";

type View = {
  Icon: IconComponent;
  label: string;
  tone: Tone;
  spin?: boolean;
};

function viewFor(
  t: TFunction,
  status: SaveStatus,
  dirty: boolean,
  offline: boolean,
  providerName: string,
): View {
  // Offline takes precedence: a stale on-device copy must never read as
  // "synced". The other states (conflict, auth-error) need a live backend
  // response to arise, so they can't co-occur with being offline.
  if (offline) {
    return {
      Icon: CloudOffIcon,
      label: t("sync.offline"),
      tone: "warn",
    };
  }
  switch (status) {
    case "saving":
      return {
        Icon: SpinnerIcon,
        label: t("sync.saving"),
        tone: "busy",
        spin: true,
      };
    case "error":
      return {
        Icon: CloudAlertIcon,
        label: t("sync.failed"),
        tone: "err",
      };
    case "throttled":
      return {
        Icon: CloudAlertIcon,
        label: t("sync.throttled"),
        tone: "warn",
      };
    case "auth-error":
      return {
        Icon: CloudAlertIcon,
        label: t("sync.reauthRequired"),
        tone: "err",
      };
    case "conflict":
      return {
        Icon: CloudAlertIcon,
        label: t("sync.syncConflict"),
        tone: "err",
      };
    case "saved":
    case "idle":
      return dirty
        ? {
            Icon: CloudUploadIcon,
            label: t("sync.saveUnsaved"),
            tone: "push",
          }
        : {
            Icon: CloudCheckIcon,
            label: t("sync.syncedTo", { provider: providerName }),
            tone: "ok",
          };
  }
}

const TONE_CLASS: Record<Tone, string> = {
  ok: "border-accent/40 text-accent hover:bg-accent/10",
  busy: "border-line text-muted",
  warn: "border-link/50 text-link hover:bg-link/10",
  err: "border-danger/50 text-danger hover:bg-danger/10",
  push: "border-link bg-link/15 text-link hover:bg-link/25",
};

export function SyncStatus({
  providerName,
  status,
  dirty,
  offline,
  onOpenDetails,
}: Props) {
  const t = useT();
  const view = viewFor(t, status, dirty, offline, providerName);
  const busy = status === "saving";
  return (
    <button
      type="button"
      onClick={onOpenDetails}
      title={view.label}
      aria-label={view.label}
      aria-busy={busy || undefined}
      className={`inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[var(--radius)] border bg-transparent focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none ${TONE_CLASS[view.tone]}`}
    >
      <view.Icon
        className={`h-[18px] w-[18px] ${view.spin ? "animate-spin" : ""}`}
      />
    </button>
  );
}
