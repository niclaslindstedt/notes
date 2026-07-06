// Global Cmd/Ctrl+Z · Cmd/Ctrl+Shift+Z / Ctrl+Y bound to the document
// history. The implementation lives in @niclaslindstedt/oss-framework; this
// shim keeps the app's historical import path.
export {
  useUndoRedoShortcuts,
  type UndoRedoShortcutsParams,
} from "@niclaslindstedt/oss-framework/hooks";
