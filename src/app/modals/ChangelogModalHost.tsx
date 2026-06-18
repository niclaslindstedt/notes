import { ChangelogModal } from "../../ui/changelog/ChangelogModal.tsx";
import { useModalState } from "../../ui/modal-bus.ts";

// Owns the "What's new" dialog's open state; opens on a "changelog" command
// from the modal bus.

export function ChangelogModalHost() {
  const { command, close } = useModalState("changelog");
  return <ChangelogModal open={command !== null} onClose={close} />;
}
