import { useState, type MouseEvent, type ReactNode } from "react";

import {
  ActionMenuList,
  type FloatingPlacement,
  type FloatingPoint,
  type RowAction,
} from "@niclaslindstedt/oss-framework/components";
import { useDesktopPointer } from "@niclaslindstedt/oss-framework/hooks";

import { unlock } from "../achievements/index.ts";
import { useT } from "../i18n/index.ts";
import { FloatingPanel } from "./FloatingPanel.tsx";
import { DropzoneIcon, PlusIcon } from "./icons.tsx";

const PLACEMENT: FloatingPlacement = {
  width: { kind: "max", maxPx: 240 },
  anchor: "left",
  coordinateSpace: "viewport",
};

// Things whose own right-click menu is worth more than ours: a link's "open in
// new tab", a field's paste, a button the browser can inspect.
const NATIVE_MENU_TARGETS =
  "a, button, input, textarea, select, [contenteditable]";

// Right-clicking the empty parts of a surface (the overview, the side menu's
// list) on a computer opens a small menu at the pointer whose job is to start
// a note. It is the surface-level twin of `RowActionMenu`: a row that has its
// own menu claims the click first (the framework's row menu calls
// `preventDefault`), so this one only answers what nothing else did. Touch
// devices keep the native behaviour.
export function DeadSpaceMenu({
  onNewNote,
  onNewDropzone,
  className,
  children,
}: {
  onNewNote: () => void;
  /** Offered as a second entry when dropzone notes are available. */
  onNewDropzone?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  const desktop = useDesktopPointer();
  const [point, setPoint] = useState<FloatingPoint | null>(null);

  function onContextMenu(e: MouseEvent<HTMLDivElement>) {
    if (!desktop || e.defaultPrevented) return;
    const target = e.target;
    if (target instanceof Element && target.closest(NATIVE_MENU_TARGETS))
      return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    e.preventDefault();
    setPoint({ x: e.clientX, y: e.clientY });
  }

  const actions: RowAction[] = [
    {
      label: t("app.newNote"),
      icon: <PlusIcon className="h-4 w-4" />,
      onSelect: () => {
        unlock("outOfThinAir");
        onNewNote();
      },
    },
  ];
  if (onNewDropzone)
    actions.push({
      label: t("app.dropzone.newNote"),
      icon: <DropzoneIcon className="h-4 w-4" />,
      onSelect: () => {
        unlock("outOfThinAir");
        onNewDropzone();
      },
    });

  return (
    <div className={className} onContextMenu={onContextMenu}>
      {children}
      {point && (
        <FloatingPanel
          open
          onClose={() => setPoint(null)}
          anchorPoint={point}
          placement={PLACEMENT}
          className="py-1"
        >
          <ActionMenuList
            actions={actions}
            ariaLabel={t("app.newNote")}
            onActivate={(action) => {
              setPoint(null);
              action.onSelect();
            }}
          />
        </FloatingPanel>
      )}
    </div>
  );
}
