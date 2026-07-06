// Anchored floating-panel placement (clamp / flip / width math). The
// implementation lives in @niclaslindstedt/oss-framework; this shim keeps
// the app's historical import path.
export {
  useFloatingPosition,
  computeFloatingRect,
  type FloatingRect,
  type FloatingWidth,
  type FloatingPlacement,
  type FloatingPoint,
  type FloatingAnchor,
} from "@niclaslindstedt/oss-framework/components";
