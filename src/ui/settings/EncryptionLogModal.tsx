import { useId } from "react";

import { useT } from "../../i18n/index.ts";
import { Button } from "../form/Button.tsx";
import { CloseIcon, ShieldIcon } from "../icons.tsx";
import { Modal } from "../Modal.tsx";

// The full log behind the encryption status bar. The status line in the
// Storage tab only flashes the step it's on; when a turn-on / turn-off fails,
// the (now red) status line becomes a button that opens this modal so the user
// can read the whole sequence of steps and the error that stopped it — the
// equivalent of the Logs tab, scoped to the one operation that just broke.

export type EncryptionLogEntry = {
  /** Already-translated, human-readable line. */
  text: string;
  ts: number;
  level: "info" | "error";
};

// A live snapshot of the background encryption conversion (the paced per-note
// queue that runs after encryption is turned on or off on a file/cloud
// backend). The storage settings flash `message` while `busy` and tell the user
// they can close the modal; `log` backs this modal when `error` is set. Defined
// here, in the UI layer, so both the settings UI and the app-level conversion
// hook can share the shape without crossing the app → ui boundary.
export type EncryptionConversionState = {
  busy: boolean;
  direction: "encrypt" | "decrypt" | null;
  message: string | null;
  done: number;
  total: number;
  error: string | null;
  log: EncryptionLogEntry[];
};

type Props = {
  open: boolean;
  entries: EncryptionLogEntry[];
  onClose: () => void;
};

export function EncryptionLogModal({ open, entries, onClose }: Props) {
  const t = useT();
  const titleId = useId();

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} centered>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-surface-3 px-4 py-3">
        <h2
          id={titleId}
          className="flex items-center gap-2 text-sm font-bold tracking-wide text-fg-bright"
        >
          <ShieldIcon className="h-4 w-4" />
          {t("settings.storage.encryptionLogTitle")}
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
        {entries.length === 0 ? (
          <p className="text-xs text-muted">
            {t("settings.storage.encryptionLogEmpty")}
          </p>
        ) : (
          <ul className="flex flex-col rounded border border-line bg-surface-2 font-mono text-xs">
            {entries.map((entry, idx) => (
              <li
                key={`${entry.ts}-${idx}`}
                className={`flex flex-wrap items-baseline gap-2 border-b border-l-2 border-line px-2.5 py-1.5 last:border-b-0 ${
                  entry.level === "error"
                    ? "border-l-danger"
                    : "border-l-accent"
                }`}
              >
                <span className="text-muted tabular-nums">
                  {formatLogTime(entry.ts)}
                </span>
                <span
                  className={`break-words whitespace-pre-wrap ${
                    entry.level === "error" ? "text-danger" : "text-fg"
                  }`}
                >
                  {entry.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface-3 px-4 py-3">
        <Button variant="secondary" onClick={onClose}>
          {t("common.close")}
        </Button>
      </footer>
    </Modal>
  );
}

function formatLogTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}
