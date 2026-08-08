import { useModalState } from "../../ui/modal-bus.ts";
import { lazyModal } from "./lazy-modal.tsx";

// "What's new" — the parsed changelog and its renderer, read once per release
// at most. Split off; see `lazy-modal.tsx`.
const ChangelogModal = lazyModal(() =>
  import("../../ui/changelog/ChangelogModal.tsx").then((m) => m.ChangelogModal),
);

// Owns the "What's new" dialog's open state; opens on a "changelog" command
// from the modal bus.

export function ChangelogModalHost() {
  const { command, close } = useModalState("changelog");
  return <ChangelogModal open={command !== null} onClose={close} />;
}
