# Configuration

`notes` has no configuration file — it runs with sensible defaults out of the
box. The few knobs that exist are build-time environment variables and
generated assets.

## Build-time environment

| Variable           | Default | Purpose                                                                                 |
| ------------------ | ------- | --------------------------------------------------------------------------------------- |
| `VITE_BASE`        | `/`     | The base path the app is served from. The deploy workflow sets this so the same bundle works at `/` or `/notes/`. |
| `GITHUB_RUN_NUMBER`| —       | Set by GitHub Actions; appended to the build label so you can tell which build is live. |
| `GITHUB_SHA`       | —       | Set by GitHub Actions; its short form is appended to the build label as `+<commit>`.    |

None are required for local development.

## PWA manifest

The web app manifest is defined inline in `vite.config.ts` (the `VitePWA`
plugin's `manifest` block): name, theme color (`#1f2933`), icons, and the
`id`/`scope`/`start_url` (all derived from `VITE_BASE`). Edit it there.

## Icons

Icons are generated from `public/favicon.svg` by
[`@vite-pwa/assets-generator`](https://vite-pwa-org.netlify.app/assets-generator/),
configured in `pwa-assets.config.ts`:

```sh
npm run icons
```

This writes `public/pwa-{64,192,512}.png`, `public/maskable-icon-512x512.png`,
and `public/apple-touch-icon-180x180.png`. The config overrides the preset's
default padding so the dark background bleeds to every edge — no white frame on
the iOS tile, nothing revealed under an Android launcher mask. Commit the
regenerated PNGs; the manifest references them by name.

## Theme

The default theme is dark. The available presets (`dark`, `light`, `system`)
and their palettes live in `src/styles/theme.css` (the CSS tokens) and
`src/theme/useTheme.ts` (the engine that writes `data-theme`). The user's
choice is persisted to `localStorage` under `notes/theme`.
