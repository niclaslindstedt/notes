// Pure geometry for the draggable floating navigation button. The
// implementation lives in @niclaslindstedt/oss-framework; this shim keeps
// the app's historical import path.
export {
  type MenuButtonSide,
  type MenuButtonPosition,
  MENU_BUTTON_SIZE,
  MENU_BUTTON_MARGIN,
  clampUnit,
  restingRect,
  clampRect,
  rectToPosition,
} from "@niclaslindstedt/oss-framework/sidebar";
