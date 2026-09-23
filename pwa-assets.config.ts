import {
  defineConfig,
  minimal2023Preset as preset,
} from "@vite-pwa/assets-generator/config";

// Drives @vite-pwa/assets-generator. Source: public/favicon.svg.
// Output (committed): public/pwa-{64,192,512}.png,
// public/maskable-icon-512x512.png, and
// public/apple-touch-icon-180x180.png. The manifest in `vite.config.ts`
// references the same icon bytes.
//
// We override all three variants from `minimal2023Preset`, which bakes a
// white border around the SVG — iOS renders it as a white frame on the
// home-screen tile, Android reveals it under launcher masks, and the macOS
// Dock reads it as a legacy icon and pads it out further still. The SVG
// paints `#0e1116` edge-to-edge itself (matches `manifest.theme_color`) and
// sizes its own mark, so the generator only has to not add a margin:
//   - transparent + apple: padding 0 → the SVG lands on the canvas 1:1,
//     full-bleed and opaque. iOS and Windows round or square it themselves.
//   - maskable: padding 0.1, dark background → the mark is inset a further
//     10% so it clears the W3C 80%-diameter safe circle, while the dark
//     colour still bleeds to all four edges.
//
// `padding: p` resizes the whole SVG to `size * (1 - p)` and centres it on
// the background — it does NOT inset only the artwork, so it compounds with
// the mark's own scale in `favicon.svg`. Change either and re-check both.
//
// The desktop app's icons are not made here: `scripts/gen-native-icons.mjs`
// cuts them for `tauri/src-tauri/icons/` from the same mark, opaque and edge
// to edge, which is what the macOS Dock wants — it masks every app icon into
// the system squircle, and artwork with a transparent margin is read as a
// small legacy icon and inset onto a light backdrop.

const THEME_BACKGROUND = "#0e1116";

export default defineConfig({
  preset: {
    ...preset,
    transparent: {
      ...preset.transparent,
      padding: 0,
      resizeOptions: { fit: "contain", background: THEME_BACKGROUND },
    },
    apple: {
      ...preset.apple,
      padding: 0,
      resizeOptions: { fit: "contain", background: THEME_BACKGROUND },
    },
    maskable: {
      ...preset.maskable,
      sizes: [512],
      padding: 0.1,
      resizeOptions: { fit: "contain", background: THEME_BACKGROUND },
    },
  },
  images: ["public/favicon.svg"],
});
