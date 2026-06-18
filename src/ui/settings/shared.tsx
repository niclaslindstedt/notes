import { useId, type ReactNode } from "react";

import { Checkbox } from "../form/Checkbox.tsx";

// Presentational building blocks shared by the settings sections, ported
// from checklist's `tabs/shared`. Pared down: notes' sections are short, so
// there's no auto-collapse machinery.

/** A labelled settings group rendered as a bordered fieldset. */
export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="mt-3 rounded border border-line bg-surface-3 p-3 first:mt-0"
    >
      <div
        id={titleId}
        className="mb-2 text-xs font-bold tracking-wide text-muted uppercase"
      >
        {title}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

/** A labelled row of custom controls. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const labelId = useId();
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className="flex flex-col gap-1.5"
    >
      <span id={labelId} className="text-xs text-muted">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** A checkbox row with a visible label and optional hint. */
export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <span className="mt-0.5">
        <Checkbox checked={checked} onChange={onChange} ariaLabel={label} />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm text-fg-bright">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

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
