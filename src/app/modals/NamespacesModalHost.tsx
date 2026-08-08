import type { UseStorageBackend } from "../../storage/useStorageBackend.ts";
import { useModalState } from "../../ui/modal-bus.ts";
import { lazyModal } from "./lazy-modal.tsx";

// Namespace management — reached from the drawer's namespaces header, and
// only by someone who keeps more than one. Split off; see `lazy-modal.tsx`.
const NamespacesModal = lazyModal(() =>
  import("../../ui/NamespacesModal.tsx").then((m) => m.NamespacesModal),
);

// Owns the namespace-management dialog's open state; opens on a "namespaces"
// command from the modal bus. The namespace data and operations come from
// `useStorageBackend` via App.

export function NamespacesModalHost({
  storage,
}: {
  storage: UseStorageBackend;
}) {
  const { command, close } = useModalState("namespaces");
  return (
    <NamespacesModal
      open={command !== null}
      onClose={close}
      namespaces={storage.namespaces}
      activeNamespace={storage.activeNamespace}
      onSwitch={storage.switchNamespace}
      onCreate={storage.createNamespace}
      onRename={storage.renameNamespace}
      onSetAppearance={storage.setNamespaceAppearance}
      onRemove={storage.removeNamespace}
    />
  );
}
