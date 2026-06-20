import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { CheckIcon, ChevronDownIcon } from "../icons.tsx";
import { FloatingPanel } from "../FloatingPanel.tsx";
import type { FloatingPlacement } from "../hooks/useFloatingPosition.ts";

export type SelectOption<T extends string | number> = {
  value: T;
  label: React.ReactNode;
  // Optional secondary line shown under the label in the option list.
  hint?: React.ReactNode;
  // Inline style applied to the option's label (e.g. a font preview).
  labelStyle?: React.CSSProperties;
  disabled?: boolean;
};

type Props<T extends string | number> = {
  value: T;
  options: SelectOption<T>[];
  onChange: (next: T) => void;
  // Override placement defaults (minimum-width grows to the trigger,
  // left anchor, `document` coordinate space).
  placement?: Partial<FloatingPlacement>;
  // Tailwind classes for the trigger button — defaults to the standard
  // bordered-field look used elsewhere in settings.
  triggerClassName?: string;
  // Tailwind classes for the floating panel (e.g. `max-h-64
  // overflow-y-auto` for long option lists).
  panelClassName?: string;
  // Custom rendering for the trigger's current-value label. Defaults to
  // the selected option's `label`.
  renderValue?: (option: SelectOption<T> | null) => React.ReactNode;
  // Required when no visible label wraps the picker (the settings rows
  // already supply one via the surrounding `Field`).
  ariaLabel?: string;
  disabled?: boolean;
};

const DEFAULT_PLACEMENT: FloatingPlacement = {
  width: { kind: "min", minPx: 160 },
  anchor: "left",
  coordinateSpace: "document",
};

// Custom <select> replacement built on FloatingPanel. The trigger is
// styled like the bordered fields in the settings sections; the panel is
// a `role="listbox"` of `role="option"` buttons. Full keyboard nav:
// ArrowUp / Down to move highlight, Home / End to jump, Enter / Space to
// commit, Escape to dismiss without committing.
export function SelectPicker<T extends string | number>({
  value,
  options,
  onChange,
  placement,
  triggerClassName,
  panelClassName,
  renderValue,
  ariaLabel,
  disabled,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<number>(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );

  // Seed the highlight to the currently selected option each time the
  // panel opens so ArrowDown moves to "the next thing", not back to
  // the top.
  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => o.value === value);
    setHighlight(idx === -1 ? 0 : idx);
  }, [open, options, value]);

  const close = useCallback(() => {
    setOpen(false);
    setHighlight(-1);
  }, []);

  const commit = useCallback(
    (option: SelectOption<T>) => {
      if (option.disabled) return;
      onChange(option.value);
      close();
      triggerRef.current?.focus();
    },
    [onChange, close],
  );

  const moveHighlight = useCallback(
    (delta: number) => {
      if (options.length === 0) return;
      setHighlight((prev) => {
        const start = prev === -1 ? 0 : prev;
        let next = start;
        for (let i = 0; i < options.length; i++) {
          next = (next + delta + options.length) % options.length;
          if (!options[next]?.disabled) return next;
        }
        return prev;
      });
    },
    [options],
  );

  function handleTriggerKey(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (
      e.key === "ArrowDown" ||
      e.key === "ArrowUp" ||
      e.key === "Enter" ||
      e.key === " "
    ) {
      e.preventDefault();
      setOpen(true);
    }
  }

  function handleListKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveHighlight(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveHighlight(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      const i = options.findIndex((o) => !o.disabled);
      if (i !== -1) setHighlight(i);
    } else if (e.key === "End") {
      e.preventDefault();
      for (let i = options.length - 1; i >= 0; i--) {
        if (!options[i]?.disabled) {
          setHighlight(i);
          break;
        }
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const option = options[highlight];
      if (option) commit(option);
    }
  }

  const triggerClasses =
    triggerClassName ??
    "flex w-full cursor-pointer items-center gap-2 rounded border border-line bg-surface-2 px-2.5 py-1 text-left text-sm text-fg hover:border-accent focus-visible:border-accent focus-visible:outline-none";

  const finalPlacement: FloatingPlacement = {
    ...DEFAULT_PLACEMENT,
    ...placement,
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleTriggerKey}
        className={`${triggerClasses} ${disabled ? "cursor-not-allowed opacity-60" : ""}`.trim()}
      >
        <span className="flex-1 truncate">
          {renderValue ? renderValue(selected) : (selected?.label ?? "")}
        </span>
        <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
      </button>

      <FloatingPanel
        open={open && !disabled}
        onClose={close}
        triggerRef={triggerRef}
        placement={finalPlacement}
        className={`py-1 ${panelClassName ?? ""}`.trim()}
      >
        <div
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          onKeyDown={handleListKey}
          // Auto-focus the listbox when it opens so keyboard nav works
          // without an extra click.
          ref={(el) => {
            if (el && open) el.focus();
          }}
          className="outline-none"
        >
          {options.map((option, i) => {
            const isSelected = option.value === value;
            const isHighlighted = i === highlight;
            return (
              <button
                key={String(option.value)}
                type="button"
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                disabled={option.disabled}
                onMouseEnter={() => !option.disabled && setHighlight(i)}
                onClick={() => commit(option)}
                className={`flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2 text-left text-sm text-fg ${
                  option.disabled
                    ? "cursor-not-allowed opacity-50"
                    : isHighlighted
                      ? "bg-surface-3 text-fg-bright"
                      : "hover:bg-surface-3"
                }`}
              >
                <span className="flex flex-1 flex-col gap-0.5 truncate">
                  <span className="truncate" style={option.labelStyle}>
                    {option.label}
                  </span>
                  {option.hint && (
                    <span className="truncate text-xs text-muted">
                      {option.hint}
                    </span>
                  )}
                </span>
                {isSelected && (
                  <CheckIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
                )}
              </button>
            );
          })}
        </div>
      </FloatingPanel>
    </>
  );
}
