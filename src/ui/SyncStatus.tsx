import type { ReactElement } from "react";

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
// cloud-alert for conflict / auth / throttle / generic errors. Tapping the
// upload glyph saves now; every other state opens the sync-details modal.
// Errors take precedence over the dirty upload glyph because if the round-trip
// is failing, "save now" can't make progress until the user sees and acts on
// it.

type Props = {
  providerName: string;
  status: SaveStatus;
  dirty: boolean;
  /** True when the backend is unreachable and we're on the on-device copy. */
  offline: boolean;
  onSave: () => void;
  onOpenDetails: () => void;
};

type IconComponent = (props: { className?: string }) => ReactElement;

type Tone = "ok" | "busy" | "warn" | "err" | "push";

type View = {
  Icon: IconComponent;
  label: string;
  tone: Tone;
  spin?: boolean;
  action: "save" | "open";
};

function viewFor(
  status: SaveStatus,
  dirty: boolean,
  offline: boolean,
  providerName: string,
): View {
  // Offline takes precedence: a stale on-device copy must never read as
  // "synced". The other states (conflict, auth-error) need a live backend
  // response to arise, so they can't co-occur with being offline.
  if (offline) {
    return { Icon: CloudOffIcon, label: "Offline", tone: "warn", action: "open" };
  }
  switch (status) {
    case "saving":
      return {
        Icon: SpinnerIcon,
        label: "Saving…",
        tone: "busy",
        spin: true,
        action: "open",
      };
    case "error":
      return {
        Icon: CloudAlertIcon,
        label: "Sync failed",
        tone: "err",
        action: "open",
      };
    case "throttled":
      return {
        Icon: CloudAlertIcon,
        label: "Rate limited — retrying",
        tone: "warn",
        action: "open",
      };
    case "auth-error":
      return {
        Icon: CloudAlertIcon,
        label: "Reconnect needed",
        tone: "err",
        action: "open",
      };
    case "conflict":
      return {
        Icon: CloudAlertIcon,
        label: "Sync conflict",
        tone: "err",
        action: "open",
      };
    case "saved":
    case "idle":
      return dirty
        ? {
            Icon: CloudUploadIcon,
            label: "Save unsaved changes",
            tone: "push",
            action: "save",
          }
        : {
            Icon: CloudCheckIcon,
            label: `Synced to ${providerName}`,
            tone: "ok",
            action: "open",
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
  onSave,
  onOpenDetails,
}: Props) {
  const view = viewFor(status, dirty, offline, providerName);
  const busy = status === "saving";
  const onClick = view.action === "save" ? onSave : onOpenDetails;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={view.label}
      aria-label={view.label}
      aria-busy={busy || undefined}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius)] border bg-transparent focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none ${
        busy ? "cursor-not-allowed" : "cursor-pointer"
      } ${TONE_CLASS[view.tone]}`}
    >
      <view.Icon
        className={`h-[18px] w-[18px] ${view.spin ? "animate-spin" : ""}`}
      />
    </button>
  );
}
