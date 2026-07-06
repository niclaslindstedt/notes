// Swipe-to-reveal / swipe-to-dismiss gesture for a list row. The
// implementation lives in @niclaslindstedt/oss-framework; this shim keeps
// the app's historical import path. The bare `useRowSwipe(onArchive)` call
// shape maps onto the framework's legacy default: a trailing action-strip
// reveal plus a leading commit firing the callback.
export {
  useRowSwipe,
  type RowSwipe,
  type RowSwipeSide,
  type RowSwipeOptions,
} from "@niclaslindstedt/oss-framework/hooks";
