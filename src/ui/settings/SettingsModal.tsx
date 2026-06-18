import { CloseIcon, CogIcon } from "../icons.tsx";
import { Modal } from "../Modal.tsx";

// Settings dialog. A skeleton for now: the header chrome and the modal
// shell are in place, but the body is intentionally empty until there's a
// preference worth surfacing. checklist's full tabbed dialog (a left rail
// of icon-marked tabs — General, Theme, Storage, …, each editing a draft
// committed on Save) is what this grows into; bring those tabs over with
// the `copy-feature` skill as the matching subsystems land in notes. The
// header / close-button geometry already matches checklist so the port
// slots straight in.

type Props = {
  open: boolean;
  onClose: () => void;
};

export function SettingsModal({ open, onClose }: Props) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="settings-title">
      <header className="relative flex shrink-0 items-center justify-between gap-2 border-b border-line bg-surface-3 px-4 py-3">
        <h2
          id="settings-title"
          className="text-sm font-bold tracking-wide text-fg-bright"
        >
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex shrink-0 text-accent">
              <CogIcon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0">Settings</span>
          </span>
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="-mr-1 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </header>

      <div className="flex flex-1 items-center justify-center overflow-y-auto px-4 py-10">
        <p className="max-w-sm text-center text-sm text-muted">
          Nothing to configure yet — settings will land here as the app grows.
        </p>
      </div>
    </Modal>
  );
}
