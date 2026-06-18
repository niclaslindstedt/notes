import type { UseStorageBackend } from "../../storage/useStorageBackend.ts";
import { SettingsModal } from "../../ui/settings/SettingsModal.tsx";
import { useModalState } from "../../ui/modal-bus.ts";

// Owns the settings dialog's open state. A "settings" command from the modal
// bus opens it; closing dispatches the bus's `close`. The storage controls
// are threaded through so the Storage section can drive the active backend.
export function SettingsModalHost({ storage }: { storage: UseStorageBackend }) {
  const { command, close } = useModalState("settings");
  return (
    <SettingsModal open={command !== null} onClose={close} storage={storage} />
  );
}
