import { CHANGELOG_IN_BUILD } from "../../build-env.ts";
import { useModalState } from "../../ui/modal-bus.ts";
import { lazyModal } from "./lazy-modal.tsx";

// "What's new" — the parsed changelog and its renderer, read once per release
// at most. Split off; see `lazy-modal.tsx`. Not in the phone app at all
// (`CHANGELOG_IN_BUILD`): there the loader folds to nothing, so neither the
// modal nor CHANGELOG.md and the feature docs it inlines reach the bundle.
const ChangelogModal = CHANGELOG_IN_BUILD
  ? lazyModal(() =>
      import("../../ui/changelog/ChangelogModal.tsx").then(
        (m) => m.ChangelogModal,
      ),
    )
  : null;

// Owns the "What's new" dialog's open state; opens on a "changelog" command
// from the modal bus.

export function ChangelogModalHost() {
  const { command, close } = useModalState("changelog");
  if (!ChangelogModal) return null;
  return <ChangelogModal open={command !== null} onClose={close} />;
}
