import { useT } from "../i18n/index.ts";
import { haptics } from "../platform/native-bridge.ts";
import { LockIcon, LockOpenIcon } from "./icons.tsx";

// The editor header's padlock: locks the open note read-only, and unlocks it
// again. A locked note still opens, reads, selects, copies and exports exactly
// as before — what the lock takes away is the caret, and with it the soft
// keyboard and every edit (see `docs/overview.md#lock-a-note`).
//
// Like the star beside it, it reports its state through its own artwork — a
// closed padlock while the note is locked, an open one while it isn't — rather
// than the filled-background treatment the find and formatting toggles use for
// "this panel is open". This is a property of the note, not a surface being
// held open. The closed state is drawn in the accent fill as well, because a
// locked note is a state the user has to be able to spot at a glance before
// wondering why their typing isn't landing.
export function LockButton({
  locked,
  onToggle,
}: {
  locked: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const label = locked ? t("app.unlock") : t("app.lock");
  return (
    <button
      type="button"
      // Cancel the mousedown so the press doesn't blur the editing surface —
      // the same reason the star does (and so unlocking hands the caret back
      // where it was rather than nowhere).
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        haptics.vibrate(8);
        onToggle();
      }}
      title={label}
      aria-label={label}
      aria-pressed={locked}
      className={`inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] border transition-colors focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none ${
        locked
          ? "border-accent bg-accent text-page-bg"
          : "border-accent/40 bg-transparent text-accent hover:bg-accent/10"
      }`}
    >
      {locked ? (
        <LockIcon className="h-[18px] w-[18px]" />
      ) : (
        <LockOpenIcon className="h-[18px] w-[18px]" />
      )}
    </button>
  );
}
