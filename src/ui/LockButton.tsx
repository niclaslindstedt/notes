import { useT } from "../i18n/index.ts";
import { haptics } from "../platform/native-bridge.ts";
import { EyeIcon } from "./icons.tsx";

// The editor header's read-only toggle: locks the open note so it can only be
// read, and unlocks it again. A locked note still opens, reads, selects, copies
// and exports exactly as before — what the lock takes away is the caret, and
// with it the soft keyboard and every edit (see `docs/overview.md#lock-a-note`).
//
// It wears an **eye**, not a padlock, and that is the whole point of the glyph:
// this app already spends the padlock on [encryption at rest](
// ../../docs/overview.md#encryption) — `LockIcon`, worn by the lock on an
// encrypted note's card — and two padlocks standing for two unrelated features
// on one screen read as one feature with a confusing second state. An eye says
// what this lock actually does: you may look, not touch. (It is not a secrecy
// feature and must not be mistaken for one.)
//
// One glyph rather than the star's outline/filled pair, because there is no
// second eye that means "editable" without also meaning "hidden" — so the state
// is carried by the accent fill instead, the treatment the ⋯ / find / formatting
// toggles use for "this mode is on". A locked note has to be spottable at a
// glance, before the user wonders why their typing isn't landing.
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
      <EyeIcon className="h-[18px] w-[18px]" />
    </button>
  );
}
