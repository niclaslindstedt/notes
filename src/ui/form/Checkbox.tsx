import { CheckIcon } from "../icons.tsx";

// Accessible custom checkbox, ported from checklist. The native input is
// visually hidden (`sr-only`) but still receives focus, fires change
// events, and is announced by screen readers; a sibling <span> renders the
// visual, keyed off the input's `:checked` state via Tailwind's `peer:`
// variant. The native checkbox chrome is never shown.

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  // Accessible label — the visible label lives outside the control, so the
  // checkbox carries its own name for screen readers.
  ariaLabel: string;
  className?: string;
};

export function Checkbox({ checked, onChange, ariaLabel, className }: Props) {
  return (
    <label
      className={`inline-flex shrink-0 cursor-pointer items-center ${className ?? ""}`.trim()}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="flex h-5 w-5 items-center justify-center rounded-sm border-2 border-muted text-page-bg transition-colors peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
      >
        <CheckIcon
          className={`h-3.5 w-3.5 ${checked ? "opacity-100" : "opacity-0"}`}
        />
      </span>
    </label>
  );
}
