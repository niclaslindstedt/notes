import { useCallback, useRef, useState, type ReactNode } from "react";

import { unlock } from "../achievements/index.ts";
import { FloatingPanel } from "./FloatingPanel.tsx";
import type { FloatingPlacement } from "./hooks/useFloatingPosition.ts";

// One row in the menu: a label, an optional leading glyph, the action it
// fires, and a `danger` flag that tints destructive rows (delete) red.
export type RowAction = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
};

// The desktop counterpart to the touch swipe gestures (`useRowSwipe` on the
// overview card, `useSwipeReveal` on the side-menu row): right-clicking a
// row opens this menu of the same actions — archive / restore, delete — built
// on the same `FloatingPanel` the custom dropdown (`SelectPicker`) uses. The
// panel anchors to the row element and is portalled to `document.body`, so it
// escapes any transformed ancestor (the side-menu drawer carries a
// `translateX`) and clamps itself into the viewport. `enabled` gates the
// whole thing off on touch devices, where the native context menu and the
// swipe gestures are left untouched.
const PLACEMENT: FloatingPlacement = {
  width: { kind: "max", maxPx: 240 },
  anchor: "left",
  coordinateSpace: "document",
};

export function RowActionMenu({
  actions,
  enabled = true,
  ariaLabel,
  children,
}: {
  actions: RowAction[];
  enabled?: boolean;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setHighlight(-1);
  }, []);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      // Touch devices keep their native menu and their swipe gestures.
      if (!enabled || actions.length === 0) return;
      e.preventDefault();
      setHighlight(-1);
      setOpen(true);
      unlock("rightClick");
    },
    [enabled, actions.length],
  );

  const activate = useCallback(
    (action: RowAction) => {
      close();
      action.onSelect();
    },
    [close],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % actions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + actions.length) % actions.length);
      } else if (e.key === "Home") {
        e.preventDefault();
        setHighlight(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setHighlight(actions.length - 1);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const action = actions[highlight];
        if (action) activate(action);
      }
    },
    [actions, highlight, activate],
  );

  return (
    <div ref={wrapRef} onContextMenu={onContextMenu}>
      {children}
      <FloatingPanel
        open={open && enabled}
        onClose={close}
        triggerRef={wrapRef}
        placement={PLACEMENT}
        className="py-1"
      >
        <div
          role="menu"
          aria-label={ariaLabel}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          // Focus the menu when it opens so Escape and arrow-key nav work
          // without an extra click (FloatingPanel restores focus on close).
          ref={(el) => {
            if (el && open) el.focus();
          }}
          className="outline-none"
        >
          {actions.map((action, i) => {
            const isHighlighted = i === highlight;
            return (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => activate(action)}
                className={`flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2 text-left text-sm ${
                  action.danger ? "text-danger" : "text-fg"
                } ${
                  isHighlighted
                    ? action.danger
                      ? "bg-danger/10"
                      : "bg-surface-3 text-fg-bright"
                    : action.danger
                      ? "hover:bg-danger/10"
                      : "hover:bg-surface-3"
                }`}
              >
                {action.icon && <span className="shrink-0">{action.icon}</span>}
                <span className="flex-1 truncate">{action.label}</span>
              </button>
            );
          })}
        </div>
      </FloatingPanel>
    </div>
  );
}
