import {
  clearUnseenAchievements,
  useAppearance,
} from "../../theme/useTheme.ts";
import { useModalState } from "../../ui/modal-bus.ts";
import { lazyModal } from "./lazy-modal.tsx";

// Shares the glyph set and copy with the tour above, so it costs almost
// nothing once either has been opened. Split off; see `lazy-modal.tsx`.
const AchievementUnlockModal = lazyModal(() =>
  import("../../ui/achievements/AchievementUnlockModal.tsx").then(
    (m) => m.AchievementUnlockModal,
  ),
);

// Owns the unlock-notification modal's open state; opens on an
// "achievements-unlock" command from the modal bus (the lit trophy button).
// Lists the unseen unlocks and, on close, clears the unseen queue so the
// trophy returns to its quiet state.

export function AchievementsUnlockModalHost() {
  const { command, close } = useModalState("achievements-unlock");
  const { unseenAchievements } = useAppearance();
  return (
    <AchievementUnlockModal
      open={command !== null}
      unseenIds={unseenAchievements}
      onClose={() => {
        close();
        clearUnseenAchievements();
      }}
    />
  );
}
