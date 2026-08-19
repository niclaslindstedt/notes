import { useId, useRef, useState } from "react";

import { FloatingPanel } from "../FloatingPanel.tsx";
import type { FloatingPlacement } from "../hooks/useFloatingPosition.ts";
import { CheckIcon, ChevronDownIcon } from "../icons.tsx";
import { Button, type ButtonVariant } from "./Button.tsx";

// A **split button**: one action button with a chevron welded to its right
// edge that drops a menu of variants of that action. Pressing the button runs
// whichever variant is currently selected; picking one from the menu selects
// it *and* runs it, so the next plain press repeats what you just did.
//
// The settings footer wears two of them — Save (at which width?) and Reset (to
// which width?) — and they are the reason it exists: both are one action with a
// scope attached, and a scope is exactly the sort of thing you set once and
// then stop thinking about. Spelling the choice out as three separate buttons
// would triple the footer; hiding it in a preference would make it
// undiscoverable.
//
// The two halves are `Button`s sharing a seam (the right one loses its left
// rounding, the left one its right), so the pair inherits the app's button
// styling rather than reimplementing it.

const PANEL_PLACEMENT: FloatingPlacement = {
  width: { kind: "min", minPx: 210 },
  anchor: "right",
  coordinateSpace: "viewport",
};

export type SplitButtonOption<T extends string> = {
  value: T;
  label: string;
  /** One line under the label saying who the choice reaches. Optional. */
  description?: string;
};

type Props<T extends string> = {
  /** The action's name — the label on the pressable half. */
  label: string;
  variant?: ButtonVariant;
  /** The currently selected variant; the plain press runs this one. */
  value: T;
  /**
   * The variants on offer. A caller filters this down to what actually
   * applies — the Reset menu only lists a width that holds settings — so an
   * option is never shown as unavailable, it is simply absent.
   */
  options: readonly SplitButtonOption<T>[];
  /** Run a variant. Fired by the plain press and by a menu pick alike. */
  onSelect: (value: T) => void;
  /** Accessible name for the chevron half and the menu it opens. */
  menuLabel: string;
};

export function SplitButton<T extends string>({
  label,
  variant = "secondary",
  value,
  options,
  onSelect,
  menuLabel,
}: Props<T>) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value) ?? options[0];

  // Nothing to choose between — render a plain button rather than a chevron
  // that drops a menu of one.
  if (options.length <= 1) {
    return (
      <Button
        variant={variant}
        onClick={() => selected && onSelect(selected.value)}
      >
        {label}
      </Button>
    );
  }

  return (
    <div className="inline-flex">
      <Button
        variant={variant}
        className="rounded-r-none"
        // The seam: without this the two borders stack into a double-width
        // line between the halves.
        style={{ marginRight: "-1px" }}
        onClick={() => selected && onSelect(selected.value)}
        title={selected?.label}
      >
        {label}
      </Button>
      <Button
        ref={triggerRef}
        variant={variant}
        className="rounded-l-none px-2"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={menuLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDownIcon className="h-3.5 w-3.5" />
      </Button>

      <FloatingPanel
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        placement={PANEL_PLACEMENT}
        className="py-1"
      >
        <div id={menuId} role="menu" aria-label={menuLabel}>
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setOpen(false);
                  onSelect(option.value);
                }}
                className="flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/15"
              >
                <span className="mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 text-accent">
                  {active && <CheckIcon className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-sm ${active ? "font-bold text-accent" : "text-fg"}`}
                  >
                    {option.label}
                  </span>
                  {option.description && (
                    <span className="block max-w-[16rem] text-xs text-muted">
                      {option.description}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </FloatingPanel>
    </div>
  );
}
