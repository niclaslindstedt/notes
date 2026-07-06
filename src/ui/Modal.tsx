import type { ComponentProps } from "react";

import { Modal as FrameworkModal } from "@niclaslindstedt/oss-framework/components";

import { useT } from "../i18n/index.ts";

// The app's modal: @niclaslindstedt/oss-framework's accessible dialog
// (portal, focus trap, scroll lock, stacked-Escape, swipe-down-to-close on
// the mobile sheet) with the backdrop's "Close" label injected from the
// active language. Call sites keep the historical `./Modal.tsx` import and
// never pass `closeLabel` themselves.
type Props = Omit<ComponentProps<typeof FrameworkModal>, "closeLabel">;

export function Modal(props: Props) {
  const t = useT();
  return <FrameworkModal {...props} closeLabel={t("common.close")} />;
}
