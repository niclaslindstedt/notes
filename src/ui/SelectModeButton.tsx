import { useT } from "../i18n/index.ts";
import { haptics } from "../platform/native-bridge.ts";
import { LineSelectIcon } from "./icons.tsx";

/**
 * The header's **select mode** toggle, sitting immediately left of Find.
 *
 * It wears the same lit-when-open treatment as the formatting and find
 * toggles, because it is the same kind of button: it doesn't do something to
 * the note, it puts the editor into a state — and while that state is on, the
 * lit button is the only thing on screen saying so once the run has been
 * handed over or cleared.
 *
 * Its place in the row is deliberate. Find is pinned to the far right because
 * it opens a bar rather than changing anything; select mode is the next one
 * along for the same reason, and the two are the pair you reach for when you
 * want to *find your way around* the note rather than write in it.
 */
export function SelectModeButton({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const label = on ? t("app.selectMode.exit") : t("app.selectMode.enter");
  return (
    <button
      type="button"
      // The press must not take focus out of the editing surface: on a phone
      // that is what keeps the soft keyboard up, which is what lets the run be
      // typed over. The editor decides for itself where focus belongs when the
      // mode opens (see its select-mode effect).
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      onClick={() => {
        haptics.vibrate(8);
        onToggle();
      }}
      title={label}
      aria-label={label}
      aria-pressed={on}
      className={`inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius)] border transition-colors focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none ${
        on
          ? "border-accent bg-accent text-page-bg"
          : "border-accent/40 bg-transparent text-accent hover:bg-accent/10"
      }`}
    >
      <LineSelectIcon className="h-[18px] w-[18px]" />
    </button>
  );
}
