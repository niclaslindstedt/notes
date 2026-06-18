---
name: copy-feature
description: "Use whenever you want to bring a feature, look, modal, button, component, or behaviour from the checklist app into this notes app — 'port the settings modal', 'copy the side menu', 'I want checklist's theme picker', 'add the share dialog'. Clones the checklist repo, studies the named feature in place (its components, hooks, storage, styles, and the dependencies it needs), then re-implements it here adapted to the notes domain — same structure and patterns, not a verbatim paste. Reach for this instead of hand-copying files, so the port stays idiomatic and self-consistent."
---

# Copying a feature from checklist into notes

This notes app is deliberately modelled on
[`checklist`](https://github.com/niclaslindstedt/checklist): same stack (Vite +
React 19 + Tailwind v4 + `vite-plugin-pwa` + Vitest), same `OSS_SPEC.md`
conventions, same `src/`-by-concern layout, same CSS-variable token vocabulary.
checklist is the mature sibling; notes grows by porting its features across one
at a time. This skill is the procedure for doing that **well** — adapting a
feature to the notes domain rather than dumping files that don't fit.

Most features, looks, modals, and buttons will come from checklist. Use this
skill every time, so each port lands in the same shape as the last.

## When to invoke

Invoke when the task is "bring `<thing>` over from checklist", e.g.:

- A UI surface: the settings modal, the side menu, a confirm dialog, the
  pull-to-refresh indicator, an update-progress wordmark.
- A subsystem: the full theme engine (per-editor palettes + custom-theme
  editor), undo/redo, a cloud-storage backend, share-by-URL.
- A look or interaction: a button style, a row layout, a gesture.

Do **not** invoke when:

- The feature has no checklist precedent — design it fresh in `src/` instead.
- You only need a single small utility you can read and retype in a minute
  (still _read_ checklist's version for the pattern, but you don't need the
  full clone-and-port loop).

## Step 0 — Clone the checklist repo

> **Learning, baked in:** in the Claude Code on the web sandbox the git proxy
> is scoped to this repo only. `git clone http://local_proxy@.../checklist`
> fails with **`Proxy error: repository not authorized`** (HTTP 502), and the
> GitHub MCP tools refuse it with *"repository … is not configured for this
> session"*. **checklist is public open source, so clone it directly from
> github.com over HTTPS instead** — that path is not gated by the proxy
> allow-list:

```sh
git clone --depth 1 https://github.com/niclaslindstedt/checklist.git /tmp/checklist
```

If even that is blocked (no outbound network at all), ask the user to add
`niclaslindstedt/checklist` to the session's repository scope, or to paste the
relevant files — don't guess at checklist's implementation from memory.

Clone fresh each run (`rm -rf /tmp/checklist` first if it exists) so you study
current truth, and clone to `/tmp`, never inside this repo's working tree.

## Step 1 — Locate the feature in checklist

Find every file the feature touches before copying anything. checklist's tree
is organized by concern, the same as ours:

```sh
cd /tmp/checklist
ls src                      # app/ ui/ domain/ storage/ theme/ pwa/ styles/ i18n/ ...
ls src/ui src/app/modals    # components and modal hosts live here
rg -l "<FeatureName>" src    # ripgrep the term and the component name
```

Read `/tmp/checklist/AGENTS.md` and `/tmp/checklist/docs/` first — checklist
keeps a dictionary/overview that maps user vocabulary ("the sync glyph", "keep
mine") to concrete files. Use it to resolve what the user actually means.

Trace the whole dependency cone of the feature:

- The component(s) under `src/ui/` and any modal host under `src/app/modals/`.
- Hooks / state it reads (`src/app/use-*.ts`, context modules).
- Pure logic under `src/domain/` it calls.
- Persistence under `src/storage/` it touches.
- Styles: Tailwind classes plus any CSS variables from `src/styles/` /
  `src/theme/`.
- npm dependencies it imports (check `/tmp/checklist/package.json`).

## Step 2 — Map checklist paths to notes paths

The layouts line up one-to-one. Port into the matching concern:

| checklist                       | notes                          |
| ------------------------------- | ------------------------------ |
| `src/ui/<Component>.tsx`        | `src/ui/<Component>.tsx`        |
| `src/app/modals/<X>Host.tsx`    | `src/app/modals/<X>Host.tsx`    |
| `src/app/use-<x>.ts`            | `src/app/use-<x>.ts`           |
| `src/domain/<x>.ts`             | `src/domain/<x>.ts`            |
| `src/storage/<x>.ts`            | `src/storage/<x>.ts`           |
| `src/theme/*`, `src/styles/*`   | `src/theme/*`, `src/styles/*`   |
| `src/pwa/*`                     | `src/pwa/*`                    |

Honour the dependency rule the eslint config enforces in both repos:
`app → ui → domain`, `app → storage → domain`; **nothing in `domain/` imports
from `ui/`, `storage/`, `app/`, or touches the DOM.** A feature that reaches
across these layers in checklist must keep the same separation here.

## Step 3 — Bring over dependencies it needs

If the feature imports an npm package this repo doesn't have yet, add it at the
**same version** checklist pins (copy the spec from
`/tmp/checklist/package.json`):

```sh
# Read the exact version first, then install it.
rg '"<package>"' /tmp/checklist/package.json
npm install <package>@<version>          # or -D for tooling/dev deps
```

Only add what the feature actually imports — don't pull checklist's whole
dependency list. After installing, re-run `npm run lint` to confirm types
resolve.

## Step 4 — Port and adapt (don't paste)

Re-create each file in its notes home, then adapt it to the notes domain. The
model here is `Note` (`src/domain/note.ts`), not checklist's templates /
checklists / items — so:

- **Rename the domain vocabulary.** checklist's `ChecklistItem`, `Template`,
  `namespace`, "list" become notes concepts (a `Note`, its `body`, the list of
  notes). Don't leave checklist nouns in the ported code.
- **Keep the structure and patterns.** Same component decomposition, same hook
  shape, same external-store pattern (`useSyncExternalStore`), same
  modal-host/`Modal` primitive, same CSS-variable usage. Consistency with
  checklist is the point.
- **Reuse our existing tokens.** Style through the `--page-bg` / `--surface` /
  `--fg` / `--accent` / `--line` / `--danger` vocabulary already in
  `src/styles/theme.css`. If the feature needs a token notes doesn't have yet,
  add it to `theme.css` (and to every palette) rather than hard-coding a hex.
- **Mind the comments.** checklist's source carries dense explanatory comments
  referencing its own features (budget app, sync slots, namespaces). Rewrite
  them for the notes context; delete ones that no longer apply. Never ship a
  comment that describes checklist.
- **i18n:** checklist routes copy through `src/i18n/`. notes has no i18n layer
  yet — either inline the English strings, or, if the feature is large, port a
  minimal i18n surface first as its own `copy-feature` pass.

## Step 5 — Wire it in

Hook the ported feature into the notes shell (`src/app/App.tsx` and its state
in `src/app/use-notes.ts`). A modal needs a host and a trigger; a setting needs
a place in state and persistence. Leave the app building and navigable at every
step.

## Verification

The port is done when:

- `npm run lint` is clean (eslint + `tsc --noEmit`, zero warnings) — this also
  enforces the `domain/` purity boundary.
- `npm run test` passes; add vitest coverage under `tests/` for any ported
  `domain/` or `storage/` logic.
- `npm run build` succeeds and the service worker still emits.
- The feature works at a **mobile viewport first** (the primary target), then
  desktop. Run `npm run dev` and check it by eye.
- No checklist-only vocabulary, comments, dead imports, or unused deps remain.
- `CHANGELOG.md` `Unreleased` notes the new user-visible feature.

## Common pitfalls

1. **Cloning via the proxy.** It will fail with "repository not authorized" —
   clone from `https://github.com/niclaslindstedt/checklist.git` (Step 0).
2. **Pasting checklist's domain nouns.** The single biggest tell of a lazy
   port. Translate every `item`/`template`/`list`/`namespace` to a notes
   concept.
3. **Hard-coded colours.** checklist sometimes inlines a hex; route everything
   through the CSS-variable tokens so theming keeps working.
4. **Forgetting a dependency's transitive needs** (a modal that imports an
   icon set, a hook that needs a context provider mounted at the root).
5. **Breaking the `domain/` boundary** by importing a hook or DOM call into a
   pure module — the linter will reject it; restructure instead of disabling
   the rule.
6. **Over-porting.** Bring the requested feature and its real dependencies, not
   the entire subsystem around it.

## Skill self-improvement

After a port:

1. If checklist's layout has drifted from the path map in Step 2, update the
   table here.
2. If you discovered a reusable sub-port (e.g. you had to bring over the
   `Modal` primitive or a minimal i18n shim before the real feature), note it
   here so the next run pulls that foundation first.
3. If the clone path changed (proxy rules, a new mirror, an auth requirement),
   update Step 0 — keep the "clone from the public github.com URL" learning
   current.
4. Commit the SKILL.md edit alongside the ported feature, and refresh
   `.last-updated`.

### Foundations already ported

These shared pieces are in `notes` now (brought over with the side menu) —
reuse them rather than re-porting:

- **Modal stack** — `src/ui/Modal.tsx` (full-screen-on-mobile / `centered`
  card, Escape-stack, scroll-lock, focus restore). i18n strings inlined.
- **Modal command-bus** — `src/ui/modal-bus.ts` + `ModalBusProvider.tsx`.
  Add a modal by extending the `ModalCommand` union and adding a host under
  `src/app/modals/`; mount the host inside `<ModalBusProvider>` in `App`.
- **Nav drawer** — `src/ui/SideMenu.tsx`, `nav-context.ts`, `app/use-nav.ts`,
  the `useDraggableMenuButton` / `useSwipeReveal` / `useEdgeSwipeOpen` /
  `useMediaQuery` hooks, `sideMenuPosition.ts` (pure, unit-tested), and
  `appViewportRect.ts`. The floating button can be hidden (the
  `showMenuButton` preference on `useNav`, persisted under
  `notes/show-menu-button`); when hidden, `useEdgeSwipeOpen` (wired in `App`)
  opens the drawer with an inward edge swipe. The toggle is only offered when
  `useStandaloneMobile()` is true.
- **Icons** — `src/ui/icons.tsx` is a single flat file (notes' layout), not
  checklist's `icons/` family split. Add new glyphs here.
- **Tokens** — `--surface-3`, `--link`, and `--density-row-py` now exist in
  every palette in `styles/palettes.css`, plus the `drawer-*` keyframes and a
  `[data-reduce-motion="true"]` override in `styles/theme.css`.
- **Theme engine** — `src/theme/themes.ts` (preset/font/custom data),
  `fonts.ts` (lazy `@fontsource` loaders for sans/serif/dyslexic), and
  `useTheme.ts` (the `useSyncExternalStore` appearance store + projection
  hook `useApplyAppearance`, called once in `App`). The colour palettes live
  in `styles/palettes.css`, one block per `data-theme`. notes carries 11
  colour slots (no checklist `meta`/`path`/`flag`/`pipe`/`success`/`positive`/
  `negative`) and a single `--radius` (not the sm/md/lg triple); it drops
  checklist's `borderWidth` control. Appearance applies **live** — notes has
  no draft/Save step. Add a preset by adding one `PRESET_PALETTES` entry +
  one `palettes.css` block + registering its id.
- **Settings primitives** — `src/ui/form/Checkbox.tsx` and
  `src/ui/settings/shared.tsx` (`Section` / `Field` / `ToggleRow` /
  `SegmentedRow`). The `SettingsModal` is **tabbed** like checklist's — a
  left icon-rail on desktop, a burger dropdown in the header on mobile — and
  lands on a General tab, with `GeneralSection` / `AppearanceSection` /
  `StorageSection` each rendered per tab (flat `*Section.tsx` files, not
  checklist's `tabs/` subfolder). There's **no draft / Save footer**: every
  control applies live through its own store. The mobile section dropdown is
  an inline `absolute` panel with a `fixed inset-0` catch-all to dismiss —
  checklist's `FloatingPanel` was **not** needed because the panel sits just
  below the header, within the card. `SelectPicker` / `FloatingPanel` remain
  un-ported — wrap-radio rows + `SegmentedRow` cover the pickers; bring
  `FloatingPanel` over only when a feature needs a genuinely positioned
  popover.
- **Namespaces** — `src/storage/namespaces.ts` (registry + the
  `namespaceLocalKey` / `namespaceCloudFolder` location helpers) and
  `namespace-store.ts` (the `namespaces.json` root registry, the
  `settings-store.ts` counterpart). Every backend takes an active-namespace
  argument: the local adapter keys per slug, the folder/Dropbox/Drive stores
  prepend a per-slug folder. **Unlike checklist, notes keeps the _default_
  namespace at the historical root** (the `notes/v1` key, the app-folder
  root) so existing data needs no migration — `namespaceCloudFolder` returns
  `""` for the default, and the file stores list **non-recursively** (notes
  are flat) so the root-scoped default never picks up sibling namespace
  folders. UI: `glyphs.ts` (inline glyph set + favicon serialiser),
  `NamespaceGlyph` / `GlyphGrid` / `ColorPalette` / `namespace-colors.ts`,
  `namespace-favicon.ts` (re-badges the tab favicon), the `NamespacesModal`
  (+ its bus host) and the switcher section in `SideMenu`. notes has no
  toast/i18n/`ConfirmDialog`/`ClearableInput`, so the modal inlines its
  English strings, uses a plain `<input>`, and arms delete with a two-tap
  "Confirm" button rather than a `ConfirmDialog`. Appearance applies live (no
  draft/Save), matching the theme engine.

### Privacy / clean-URL routing

`main.tsx` does a `location.pathname` suffix switch to mount `PrivacyPage`,
and `vite.config.ts`'s `emitPrivacyAlias` mirrors `index.html` to
`privacy/index.html`. notes has **no SEO system yet** (a deferred OSS_SPEC
item), so unlike checklist this alias does NOT splice per-route
`<title>`/canonical — it's a verbatim copy. Add the splice here when the SEO
scaffolding lands.
