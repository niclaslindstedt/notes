import type { UseStorageBackend } from "../../storage/useStorageBackend.ts";
import { updateAppearance, useAppearance } from "../../theme/useTheme.ts";
import { CloseIcon, CogIcon } from "../icons.tsx";
import { Modal } from "../Modal.tsx";
import { AppearanceSection } from "./AppearanceSection.tsx";
import { StorageSection } from "./StorageSection.tsx";

// Settings dialog. The header chrome and modal shell match checklist so its
// full tabbed dialog (a left rail of icon-marked tabs) can grow in here as
// more subsystems land; for now the body stacks the Appearance and Storage
// surfaces. Edits apply live through their stores, so there's no draft / Save
// step yet.

type Props = {
  open: boolean;
  onClose: () => void;
  storage: UseStorageBackend;
};

export function SettingsModal({ open, onClose, storage }: Props) {
  const appearance = useAppearance();
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

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          <AppearanceSection
            appearance={appearance}
            onUpdate={updateAppearance}
          />
          <StorageSection storage={storage} />
        </div>
      </div>
    </Modal>
  );
}
