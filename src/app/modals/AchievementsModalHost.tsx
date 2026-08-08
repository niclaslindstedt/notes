import { useAppearance } from "../../theme/useTheme.ts";
import { useModalState } from "../../ui/modal-bus.ts";
import { lazyModal } from "./lazy-modal.tsx";

// The four-tier catalogue tour, its glyph set, and its copy — opened from the
// trophy button. Split off; see `lazy-modal.tsx`.
const AchievementsModal = lazyModal(() =>
  import("../../ui/achievements/AchievementsModal.tsx").then(
    (m) => m.AchievementsModal,
  ),
);

// Owns the achievements tour's open state; opens on an "achievements" command
// from the modal bus (the quiet trophy button). This is the
// browse-the-whole-catalog view — it does not touch the unseen queue (that's
// the unlock modal's job).

export function AchievementsModalHost() {
  const { command, close } = useModalState("achievements");
  const { achievements } = useAppearance();
  return (
    <AchievementsModal
      open={command !== null}
      onClose={close}
      unlocked={achievements}
    />
  );
}
