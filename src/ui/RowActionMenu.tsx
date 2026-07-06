import { type ComponentProps } from "react";

import { RowActionMenu as FrameworkRowActionMenu } from "@niclaslindstedt/oss-framework/components";
import { useDesktopPointer } from "@niclaslindstedt/oss-framework/hooks";

import { unlock } from "../achievements/index.ts";

export type { RowAction } from "@niclaslindstedt/oss-framework/components";

type Props = ComponentProps<typeof FrameworkRowActionMenu>;

// The framework's right-click / long-press row action menu, plus the app's
// "rightClick" achievement: a capture-phase contextmenu listener fires the
// unlock for the same desktop gesture that opens the menu (the framework
// component exposes no on-open seam).
export function RowActionMenu({ children, ...props }: Props) {
  const desktop = useDesktopPointer();
  const active = (props.enabled ?? true) && props.actions.length > 0;
  return (
    <div
      className="contents"
      onContextMenuCapture={() => {
        if (active && desktop) unlock("rightClick");
      }}
    >
      <FrameworkRowActionMenu {...props}>{children}</FrameworkRowActionMenu>
    </div>
  );
}
