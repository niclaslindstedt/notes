// Renders one namespace glyph as an inline SVG painting with
// `currentColor`. The implementation lives in
// @niclaslindstedt/oss-framework (its `Glyph`, which falls back to the
// default folder for an unknown / missing name); this shim keeps the app's
// historical import path and name.
export { Glyph as NamespaceGlyph } from "@niclaslindstedt/oss-framework/glyphs";
