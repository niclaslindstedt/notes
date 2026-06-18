---
name: tune-pwa-icons
description: "Use when the home-screen / launcher / browser-tab icon looks wrong on a real device — too small, off-center, transparent, clipped by iOS rounding, or eaten by an Android mask — or when restyling the notes PWA artwork. Walks an edit / regenerate / inspect loop that uses the Read tool to look at the PNGs after every change, scored against Apple Human Interface Guidelines and the W3C maskable-icon spec. notes derives every PWA icon from a single source SVG via `@vite-pwa/assets-generator` (`make icons`); the manifest `icons` array lives inline in `vite.config.ts`. Manual playbook — not part of the `maintenance` umbrella."
---

# Tuning the PWA icon set

notes derives its whole PWA icon set from **one source SVG** with
`@vite-pwa/assets-generator`. The three sources of truth are:

- **The source artwork**, `public/favicon.svg`. Every raster icon is
  generated from this file — restyling the brand means editing this SVG
  and regenerating, not hand-exporting PNGs.
- **The generator config**, `pwa-assets.config.ts` at the repo root. It
  extends `@vite-pwa/assets-generator`'s `minimal2023Preset` and
  overrides the `apple` / `maskable` padding + background (via
  `THEME_BACKGROUND`) so the dark `theme_color` (`#1f2933`) bleeds
  edge-to-edge instead of the preset's default white frame.
- **The manifest**, declared inline in `vite.config.ts` under
  `VitePWA({ manifest: { icons: [...] } })`. It lists `pwa-64x64.png`,
  `pwa-192x192.png`, `pwa-512x512.png` (`purpose` defaults to `any`) and
  `maskable-icon-512x512.png` (`purpose: "maskable"`).

Running `make icons` (→ `pwa-assets-generator`) reads
`public/favicon.svg`, applies the config, and writes the committed PNGs
plus `favicon.ico` into `public/`:

```
public/favicon.svg            (the single source of truth)
   │  make icons   (pwa-assets-generator + pwa-assets.config.ts)
   ▼
   ├─ public/pwa-64x64.png               ← manifest icon (any)
   ├─ public/pwa-192x192.png             ← manifest icon (any)
   ├─ public/pwa-512x512.png             ← manifest icon (any)
   ├─ public/maskable-icon-512x512.png   ← manifest icon (maskable)
   ├─ public/apple-touch-icon-180x180.png ← <link rel="apple-touch-icon"> in index.html
   └─ public/favicon.ico                 ← legacy browser tab
   │  make build   (vite build → vite-plugin-pwa)
   ▼
   ├─► dist/<icon>.png / .ico            ← copied verbatim from public/
   └─► dist/manifest.webmanifest         ← icons array resolved from vite.config.ts
```

The generated PNGs **and** `favicon.ico` are committed to the repo.
There is **no `icons-check` CI job** in notes — nothing automatically
catches a `favicon.svg` edit that shipped without regenerating. So the
discipline is on you: **always run `make icons` and commit the
regenerated assets in the same change as any `favicon.svg` /
`pwa-assets.config.ts` edit.** An SVG change without its PNGs leaves the
committed rasters stale and the deployed icon out of sync with source.

## When to invoke

Invoke this skill whenever the home-screen / launcher / browser-tab
icon looks wrong on a real device:

- Too small relative to surrounding icons (the canonical "tiny postage
  stamp on a white square" failure mode).
- Off-centre vertically or horizontally.
- Transparent / white background on iOS while the rest of the app
  brand expects the dark `theme_color`.
- Glyph clipped by iOS's rounded corners (~22.5% radius) because it
  extends to the bleeds.
- Maskable PNG looks fine in a square but loses critical content under
  an Android circle / squircle / teardrop mask.

Also invoke when:

- Restyling the artwork (new colour, new glyph, new background) in
  `public/favicon.svg`.
- Adding or removing an icon size from the manifest `icons` array, or
  tuning the `apple` / `maskable` padding in `pwa-assets.config.ts`.

Do **not** invoke for unrelated visual work (in-app DOM/CSS — that's
the theme/styles work in `src/styles/theme.css`; the social-preview /
Open Graph image, which is a different asset).

## The iteration loop

The Read tool renders PNGs inline, which is the whole reason this
skill is fast: you can see every iteration without leaving the
session. The loop is short and is meant to be repeated.

1. **Read the current PNGs first.** Look at the apple-touch and
   maskable outputs before you change anything — the "wrong" you're
   fixing might be subtler than expected, or already fine on one path.

   ```
   Read public/apple-touch-icon-180x180.png
   Read public/maskable-icon-512x512.png
   Read public/pwa-192x192.png
   ```

2. **Edit the source, not the output.** Change `public/favicon.svg`
   (the artwork) or `pwa-assets.config.ts` (padding / background). Make
   one targeted change at a time; a change that touches several things
   at once makes it hard to diagnose which one regressed something.

3. **Regenerate.** `make icons` rewrites every PNG and `favicon.ico`
   from the source.

4. **Re-read the outputs.** Inspect each against the quality criteria
   below. Compare apple-touch and maskable side by side — they share
   source artwork, so a change that improves one will move the other.

5. **Adjust and repeat.** Usually 2–4 iterations from the current SVG
   is enough. If you're past 6 iterations, the design probably wants
   restructuring (simplify the glyph, drop a problematic detail at small
   sizes) rather than another nudge.

6. **Rebuild and check the manifest** (see Verification). The build is
   the only step that proves the manifest references resolve and the
   files copy through.

## Apple touch icon — what good looks like

Apple's [Human Interface Guidelines for app icons][hig-app-icons] plus
the legacy `apple-touch-icon` web rules: iOS uses the PNG you provide
at 180×180 verbatim for home-screen install, rounds the corners
(~22.5% radius "squircle"), and paints **no** background behind alpha.
That gives you these rules — which the generator's `apple` override
(padding 0, opaque `#1f2933` background) is tuned to satisfy:

[hig-app-icons]: https://developer.apple.com/design/human-interface-guidelines/app-icons

| Rule                                                                                  | Why                                                                                                                                                                      |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Opaque, full-bleed background.** The source SVG fills the canvas edge-to-edge.      | iOS paints transparent regions white. notes' dark `theme_color` (`#1f2933`) is painted by the `<rect>` in `favicon.svg` and the generator's `apple` background.         |
| **Foreground fills 60–80% of the canvas.** Centered.                                  | Below 60% reads as a postage stamp; above 80% gets nibbled by the corner rounding. The surrounding icons on a stock home screen sit in this band.                       |
| **No drop shadows, gloss, or system chrome.** iOS adds rounded corners; that's all.   | Pre-iOS-7 advice (round corners yourself, add gloss) is now wrong — modern iOS double-rounds and double-glosses if you do.                                              |
| **No transparency in the foreground glyph.** Use solid fills, not strokes-on-nothing. | iOS antialiasing on the rounded mask makes semi-transparent edges look fuzzy at common scales. (notes' glyph is stroked, not filled — see the note below.)              |
| **Avoid text other than a single logo glyph or wordmark.**                            | Body text becomes unreadable at the 60×60 scale iOS shows in Spotlight and notifications.                                                                               |

Colour coherence: the SVG background and the generator's `apple` /
`maskable` `background` should match the manifest `theme_color`
(`#1f2933`) so the install transition (browser tab → home-screen tile →
splash screen, which `vite-plugin-pwa` derives from `background_color`,
also `#1f2933`) stays visually continuous. If a future redesign retones
the app, retone all four literals in the same change: the `<rect>` fill
in `favicon.svg`, `THEME_BACKGROUND` in `pwa-assets.config.ts`, and
`theme_color` / `background_color` in `vite.config.ts`.

The current `public/favicon.svg` is a **document / note glyph** — a page
outline with a folded-over top-right corner and two horizontal text
lines, stroked in a green vertical gradient (`#6ee7b7` → `#34d399`, the
`ink` gradient) on a full-bleed `#1f2933` `<rect>`. It's a workable
template for the apple-touch / `purpose: "any"` icon (opaque rect under
a single centred glyph). Because the glyph is **stroked, not filled**,
its 4px strokes thin out at the smaller raster sizes — keep the strokes
chunky enough to survive `pwa-64x64`, and keep the whole glyph in the
60–80% band: too large kisses the iOS rounded-corner radius, too small
reads as a postage stamp.

## Maskable icon — what good looks like

Android (and Chromium on every OS) supports manifest icons declared
with `"purpose": "maskable"` per the
[W3C maskable icon spec][maskable-spec]. The launcher composites the
icon under a shape the OEM / theme picks at runtime (circle, squircle,
teardrop, rounded square, …), so the icon must survive **any** of
those masks. The generator's `maskable` override (padding 0.1 → the
glyph shrinks into the safe zone, opaque `#1f2933` background → it
bleeds to the edges) is tuned for this; the rules it satisfies:

[maskable-spec]: https://w3c.github.io/manifest/#icon-masks

| Rule                                                                                                                | Why                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Safe zone = centered circle of radius 40% of canvas** (80% diameter).                                             | Every standard Android adaptive-icon mask leaves this zone untouched. Critical content must live entirely inside it.                      |
| **Background bleeds to the edges.**                                                                                 | The OS may pad inward by up to 20%. A square that doesn't reach the edges shows an unintended ring of launcher background around it.       |
| **One PNG per declared purpose.** `purpose: "any"` and `purpose: "maskable"` are different icons even at same size. | A `purpose: "any maskable"` shared icon either has to be ugly when uncropped (too much background) or risks corner clipping when cropped. |
| **Don't ship rounded corners in the source.** The OS mask is the rounding.                                          | Doubled rounding looks like a smaller icon inside the icon.                                                                               |

If the glyph spills outside the safe zone after a redesign, bump the
`maskable.padding` in `pwa-assets.config.ts` (currently `0.1`) rather
than shrinking the glyph in the SVG — the SVG is shared with the
edge-to-edge `apple` / `any` icons, which want the glyph bigger. The
note's folded corner sits in the top-right; watch that it doesn't poke
outside the safe-zone circle under a tight circular mask.

## Common pitfalls

In roughly descending order of likelihood:

1. **Editing `favicon.svg` without rerunning `make icons`.** notes has
   no `icons-check` job to catch it, so the committed PNGs silently go
   stale and the deployed icon drifts from source. The two move
   together — regenerate and commit in the same change, every time.
2. **Hand-editing a generated PNG.** Pointless: the next `make icons`
   overwrites it. Change the source SVG or the config instead.
3. **Maskable content outside the 80%-diameter safe zone.** Fine in a
   square preview, clipped under an Android circle. Bump
   `maskable.padding` in `pwa-assets.config.ts`.
4. **Transparent background.** iOS paints white. The `<rect>` in
   `favicon.svg` plus the generator's opaque `background` keep the tile
   dark; don't remove either.
5. **Thin strokes vanishing at small sizes.** The glyph is stroked, not
   filled — at `pwa-64x64` a 4px stroke on a 64-unit viewBox can read as
   a faint scribble. Thicken the strokes or simplify the glyph rather
   than accepting a blurry small icon.
6. **Editing the manifest `icons` array but not the generator (or vice
   versa).** A manifest `src` with no matching generated file 404s on
   install. Keep the array in `vite.config.ts` aligned with the files
   `pwa-assets.config.ts` emits.
7. **Forgetting the `apple-touch-icon` `<link>` in `index.html`.**
   `vite-plugin-pwa` writes the manifest and registers the SW, but the
   apple-touch and favicon `<link>` tags are plain HTML you add by
   hand.
8. **Not rebuilding before judging.** `make icons` produces the PNGs,
   but only `make build` proves the manifest references resolve and the
   files land in `dist/`.

## Quality criteria checklist

Before declaring the icon set "done", walk this list against the
current files:

- [ ] `apple-touch-icon-180x180.png` has an opaque background that
      matches the manifest `theme_color` (`#1f2933`).
- [ ] The foreground glyph in apple-touch sits between roughly
      `(15%, 15%)` and `(85%, 85%)` of the canvas — visible margin on
      all four sides, no kissing the edges.
- [ ] The glyph is centred to within a few percent — eyeball it
      against a horizontal and vertical halfway line.
- [ ] `maskable-icon-512x512.png` keeps every foreground pixel within
      the inner 80%-diameter circle, and its background bleeds to all
      four edges.
- [ ] `pwa-192x192.png` is still legible at thumbnail size — the glyph
      is recognisable, not a blob — and `pwa-64x64.png`'s strokes haven't
      thinned into a scribble.
- [ ] The favicon resolves (`<link rel="icon">` tags in `index.html`
      point at files that exist in `public/`).
- [ ] `make icons` was rerun and the regenerated PNGs + `favicon.ico`
      are staged in the **same** change as the `favicon.svg` /
      `pwa-assets.config.ts` edit (no `icons-check` job will catch drift
      for you).
- [ ] `make build` succeeds and `dist/manifest.webmanifest` lists every
      icon, with the matching PNGs present in `dist/`.

## Verification

1. The PNGs in `public/` match the intended design (read them inline).
2. `make icons` was rerun and its output is committed alongside the
   source edit (no automated drift check exists — this is manual).
3. `make build` succeeds.
4. Inspect the built manifest and confirm the icons resolved:

   ```sh
   cat dist/manifest.webmanifest      # icons array present, purposes correct
   ls dist/*.png                      # the referenced PNGs copied through
   ```

   Every `src` in the manifest's `icons` array must have a matching
   file in `dist/`.
5. `make lint`, `make test`, `make build` are all green.
6. The quality-criteria checklist above clears.
7. (Manual) on a real iPhone, the home-screen tile of the deployed
   build (notes.niclaslindstedt.se) looks correct — dark background,
   prominent centred glyph, no kissing of the rounded corners. Apple's
   simulator and Chromium DevTools don't always replicate the rounding
   visually; the real device is ground truth.
8. Whether an icon/manifest change needs a changelog entry depends on
   user visibility — restyling the home-screen icon is user-visible (drop
   a `.changes/unreleased/` fragment); a sub-pixel nudge usually is not
   (opt out with `no-changelog`).

## Skill self-improvement

After a run:

1. If a new generator quirk bit the run (a preset default that needed
   overriding, an SVG feature the rasteriser dropped — the stroked glyph
   is a known one), add it to **Common pitfalls** with the smallest
   reproducer you have.
2. If the source SVG glyph / colour changed, update the description of
   `public/favicon.svg` in **Apple touch icon — what good looks like**
   so the next contributor starts from current truth.
3. If a new icon size or purpose was added to the manifest, extend the
   pipeline diagram and add a row to the **Quality criteria checklist**.
4. If the manifest `theme_color` / `background_color`, the SVG `<rect>`
   fill, or `THEME_BACKGROUND` were retoned, update every colour literal
   and call out the link so retones travel atomically.
5. Commit the skill edit alongside the icon/manifest edit so the next
   loop starts from current truth.
