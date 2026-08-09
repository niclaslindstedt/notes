// Swipe-to-reveal / swipe-to-dismiss gesture for a list row. The
// implementation lives in @niclaslindstedt/oss-framework; this wrapper keeps
// the app's historical import path and adds the screen-edge guard, so an
// inward swipe from a border stays the side menu's (see `edge-gesture.ts`).
// The bare `useRowSwipe(onArchive)` call shape maps onto the framework's
// legacy default: a trailing action-strip reveal plus a leading commit firing
// the callback.
import {
  useRowSwipe as useFrameworkRowSwipe,
  type RowSwipe,
  type RowSwipeOptions,
} from "@niclaslindstedt/oss-framework/hooks";

import { useEdgeGestureGuard } from "./edge-gesture.ts";

export type {
  RowSwipe,
  RowSwipeSide,
  RowSwipeOptions,
} from "@niclaslindstedt/oss-framework/hooks";

export function useRowSwipe(
  onDismiss?: () => void,
  options?: RowSwipeOptions,
): RowSwipe {
  const swipe = useFrameworkRowSwipe(onDismiss, options);
  const handlers = useEdgeGestureGuard(swipe.handlers);
  return { ...swipe, handlers };
}
