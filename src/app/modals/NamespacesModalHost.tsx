import type { UseStorageBackend } from "../../storage/useStorageBackend.ts";
import { NamespacesModal } from "../../ui/NamespacesModal.tsx";
import { useModalState } from "../../ui/modal-bus.ts";

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
