import { useId, useState } from "react";

import type { UseStorageBackend } from "../storage/useStorageBackend.ts";
import type { NotesSync } from "../app/use-notes-sync.ts";
import { Button } from "./form/Button.tsx";
import { Modal } from "./Modal.tsx";

// Header sync indicator for the non-browser backends. A compact status chip
// (a coloured dot + short label) that opens a details dialog spelling out what
// the sync is doing and, when something needs the user, the action to fix it
// (reconnect, try again, save now) without leaving the notes. Ported in
// spirit from checklist's header cloud glyph + sync-details modal, simplified
// to notes' status set.

type Tone = "ok" | "busy" | "warn" | "bad";

type Props = {
  sync: NotesSync;
  storage: UseStorageBackend;
};

function describe(sync: NotesSync): { label: string; tone: Tone } {
  if (sync.offline) return { label: "Offline", tone: "warn" };
  switch (sync.status) {
    case "conflict":
      return { label: "Conflict", tone: "bad" };
    case "auth-error":
      return { label: "Reconnect", tone: "bad" };
    case "error":
      return { label: "Sync failed", tone: "bad" };
    case "throttled":
    case "saving":
      return { label: "Saving…", tone: "busy" };
    case "saved":
    case "idle":
      return sync.dirty
        ? { label: "Unsaved", tone: "busy" }
        : { label: "Synced", tone: "ok" };
  }
}

const DOT: Record<Tone, string> = {
  ok: "bg-accent",
  busy: "bg-muted animate-pulse",
  warn: "bg-link",
  bad: "bg-danger",
};

export function SyncIndicator({ sync, storage }: Props) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  // The browser backend has no remote to sync against — nothing to show.
  if (storage.backend === "browser") return null;

  const { label, tone } = describe(sync);

  const reconnect = () => {
    if (storage.backend === "dropbox") storage.connectDropbox();
    else if (storage.backend === "gdrive") void storage.connectGdrive();
    else if (storage.backend === "folder") void storage.reconnectFolder();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-line px-2 py-1 text-xs text-muted hover:text-fg"
        title="Sync status"
      >
        <span className={`h-2 w-2 rounded-full ${DOT[tone]}`} aria-hidden />
        {label}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        labelledBy={titleId}
        centered
      >
        <div className="flex flex-col gap-3 p-4">
          <h2 id={titleId} className="text-sm font-bold text-fg-bright">
            {storage.adapter.label}
          </h2>
          <p className="text-xs text-muted">
            {sync.offline
              ? "You're offline. You're editing the copy saved on this device; it'll sync back up when the connection returns."
              : sync.status === "conflict"
                ? "Another device changed these notes. Choose which copy to keep in the conflict prompt."
                : sync.status === "auth-error"
                  ? "Your connection to the backend expired. Reconnect to keep syncing."
                  : sync.status === "error"
                    ? (sync.statusDetail ?? "The last save didn't go through.")
                    : sync.status === "saving" || sync.status === "throttled"
                      ? "Saving your latest changes…"
                      : sync.dirty
                        ? "You have changes that haven't been saved yet."
                        : "Your notes are up to date."}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            {sync.status === "auth-error" && (
              <Button variant="primary" onClick={reconnect}>
                Reconnect
              </Button>
            )}
            {sync.status === "error" && (
              <Button variant="primary" onClick={() => sync.saveNow()}>
                Try again
              </Button>
            )}
            {sync.dirty &&
              sync.status !== "error" &&
              sync.status !== "auth-error" && (
                <Button variant="primary" onClick={() => sync.saveNow()}>
                  Save now
                </Button>
              )}
            <Button variant="secondary" onClick={() => void sync.reload()}>
              Reload from backend
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
