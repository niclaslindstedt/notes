import { SettingsModal } from "../../ui/settings/SettingsModal.tsx";
import { useModalState } from "../../ui/modal-bus.ts";

// Owns the settings dialog's open state. A "settings" command from the
// modal bus opens it; closing dispatches the bus's `close`.
export function SettingsModalHost() {
  const { command, close } = useModalState("settings");
  return <SettingsModal open={command !== null} onClose={close} />;
}
