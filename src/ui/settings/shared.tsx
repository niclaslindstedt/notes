// Presentational building blocks shared by the settings sections. The
// Section / Field / ToggleRow trio lives in @niclaslindstedt/oss-framework;
// this module keeps the app's historical import path and carries the one
// piece the framework doesn't: `SegmentedRow`, which accepts numeric values
// (the framework's `SegmentedControl` is string-only).
export {
  Section,
  Field,
  ToggleRow,
} from "@niclaslindstedt/oss-framework/components";

/** A segmented control: a row of mutually-exclusive buttons. */
export function SegmentedRow<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex overflow-hidden rounded border border-line"
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`cursor-pointer border-0 px-3 py-1.5 text-sm tabular-nums ${
              active
                ? "bg-accent/15 text-accent"
                : "bg-surface-2 text-fg hover:bg-surface-3"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
