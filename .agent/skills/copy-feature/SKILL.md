---
name: copy-feature
description: "Use whenever you want to bring a feature, look, modal, button, component, or behaviour from the checklist app into this notes app — 'port the settings modal', 'copy the side menu', 'I want checklist's theme picker', 'add the share dialog'. Fetches the checklist repo into /tmp via the bundled clone-sibling.mjs helper (which clones checklist's external mirror, reachable even in the scoped sandbox where github.com egress is blocked), studies the named feature in place (its components, hooks, storage, styles, and the dependencies it needs), then re-implements it here adapted to the notes domain — same structure and patterns, not a verbatim paste. Reach for this instead of hand-copying files, so the port stays idiomatic and self-consistent."
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

## Step 0 — Get checklist's source into `/tmp`

Run the helper script — it puts checklist's working tree under `/tmp` and
prints the path:

```sh
node .agent/skills/copy-feature/clone-sibling.mjs checklist  # -> /tmp/checklist
# optional 2nd/3rd args: a destination and a ref
node .agent/skills/copy-feature/clone-sibling.mjs checklist /tmp/checklist some-branch
```

> **Learning, baked in:** in the Claude Code on the web sandbox the git proxy
> is scoped to this repo only — `git clone` of github.com **403s**
> (`repository not authorized`), and the GitHub MCP tools refuse a foreign
> repo with *"repository … is not configured for this session"*. Don't retry
> them or hand-curl around them. Instead, the siblings (checklist / budget)
> push-mirror themselves to an external git host (each repo's
> `.github/workflows/mirror.yml`), and that mirror **is** reachable over plain
> `git` even in the scoped sandbox. So the helper clones the mirror directly —
> `<sibling>.git` appended to `MIRROR_BASE` — giving a real checkout *with full
> history*. **The helper is the one supported path.**

> **Config (provider-agnostic, via env).** `MIRROR_BASE` = the mirror
> host+namespace, no scheme / no repo (e.g. `gitlab.com/niclaslindstedt` or
> `codeberg.org/team`) — **required**. `MIRROR_TOKEN` = the PAT, needed for a
> private mirror (omit for a public one). `MIRROR_USER` optional (default
> `oauth2`; `x-token-auth` for Bitbucket, your username for Gitea / Codeberg).

If `MIRROR_BASE` isn't set, or the clone fails (no mirror configured yet, or no
network), the helper stops with a clear error. Fix the config / create
checklist's mirror — or, if you truly can't reach it, ask the user to paste the
relevant files. Don't guess from memory, and don't fall back to the scope-locked
GitHub tools.

The helper passes `checklist` here, but it takes any sibling name (`budget`
clones budget's mirror the same way). It clears its destination first, so you
always study current truth, and writes under `/tmp`, never inside this repo's
working tree.

## Step 1 — Locate the feature in checklist

Find every file the feature touches before copying anything. checklist's tree
is organized by concern, the same as ours:

```sh
cd /tmp/checklist
ls src                      # app/ ui/ domain/ storage/ theme/ pwa/ styles/ i18n/ ...
ls src/ui src/app/modals    # components and modal hosts live here
rg -l "<FeatureName>" src    # ripgrep the term and the component name
```

**Read the docs before the code — on both sides.** Start with the
`docs/dictionary.md` + `docs/overview.md` pair (checklist keeps the same pair we
do), *then* the git history, *then* the source. The order matters:

1. **`docs/dictionary.md`** maps the user's word ("the sync glyph", "keep mine",
   "the button island") to the concrete file(s) — read both
   `/tmp/checklist/docs/dictionary.md` (to find what to port) **and** our own
   `docs/dictionary.md` (to find what we already call the same concept, and the
   notes term to translate into).
2. **`docs/overview.md`** explains how that subsystem behaves and every other
   surface it touches — read the same term in `/tmp/checklist/docs/overview.md`
   so you port the whole feature, not just the one file the request named. Read
   our `docs/overview.md` entry too when we already have a partial version (the
   "we're already half there" case).
3. Only **after** the docs have oriented you do you dig into the git history /
   changeset fragments (below) and then the actual code.

Skipping the dictionary/overview is how a port misses a surface, re-invents a
token we already have, or leaves a checklist noun in our code. Also read
`/tmp/checklist/AGENTS.md` for the repo-wide conventions.

Trace the whole dependency cone of the feature:

- The component(s) under `src/ui/` and any modal host under `src/app/modals/`.
- Hooks / state it reads (`src/app/use-*.ts`, context modules).
- Pure logic under `src/domain/` it calls.
- Persistence under `src/storage/` it touches.
- Styles: Tailwind classes plus any CSS variables from `src/styles/` /
  `src/theme/`.
- npm dependencies it imports (check `/tmp/checklist/package.json`).

### Read the feature's history for the *why*, not just the *what*

The current source tells you **what** the feature does; its **git history tells
you why it's shaped that way** — the design intent, the trap it avoids, the
behaviours it deliberately changed. Read it before porting so you re-create the
reasoning, not just the lines. Find the commits that built the feature and read
each one's message **and** the artifacts that carry the rationale:

```sh
cd /tmp/checklist
# Commits that touched the feature's files, newest first:
git log --oneline -30 -- src/ui/<Component>.tsx src/storage/<x>.ts
# The full message + diff for the one that introduced it:
git show <hash>
```

> **Learning, baked in:** checklist (like us) **squash-merges**, so a commit's
> body is usually *empty* — the subject line is just the PR title
> (`feat(nav): … (#118)`). The real rationale lives in the artifacts that PR
> shipped: the **`.changes/unreleased/*.md` changeset fragment** (the
> user-facing "what changed and why" in one sentence) and the
> **`docs/overview.md` / `docs/*.md` diff** in the same commit (the design
> narrative). Read those with `git show <hash> -- .changes/ docs/` when the
> commit body is bare. If the PR number is referenced (`(#118)`) and you have
> network, the GitHub PR description / review discussion can add context — but
> the in-repo changeset + docs diff are authoritative and always reachable.

The mirror clone carries **full history**, so `git log` / `git show` work
directly with no depth flag to fuss over. When the user names a commit or PR on
another branch ("the redesigned action bar from #112"), pass that ref as the
helper's 3rd arg so the checkout lands on it.

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

1. **Hand-cloning instead of using the Step-0 helper.** `git clone` of
   github.com 403s in a scoped session, and the git proxy / GitHub MCP are
   locked to this repo — don't retry them or hand-curl around them. Run
   `clone-sibling.mjs`, which clones checklist's mirror (`MIRROR_BASE`).
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
3. If how checklist's source is reached changed (mirror host, auth, scope,
   proxy rules), update `clone-sibling.mjs` and the Step 0 summary — keep the
   `MIRROR_BASE` mirror-clone logic current.
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
  checklist's `borderWidth` control. Like checklist, appearance edits are a
  **draft committed on Save**: the store carries an ephemeral preview override
  (`setAppearancePreview`) the projection paints while the settings dialog is
  open, and `commitAppearance` persists it (keeping the achievement map). Quick
  toggles outside the dialog still persist immediately via `updateAppearance` /
  `setTheme`. The colour slots match checklist's palettes exactly (same hexes on
  every shared slot), so keep them in lockstep. Add a preset by adding one
  `PRESET_PALETTES` entry + one `palettes.css` block + registering its id.
- **Settings primitives** — `src/ui/form/Checkbox.tsx` and
  `src/ui/settings/shared.tsx` (`Section` / `Field` / `ToggleRow` /
  `SegmentedRow`). The `SettingsModal` is **tabbed** like checklist's — a
  left icon-rail on desktop, a burger dropdown in the header on mobile — and
  lands on a General tab, with `GeneralSection` / `AppearanceSection` /
  `StorageSection` each rendered per tab (flat `*Section.tsx` files, not
  checklist's `tabs/` subfolder). Like checklist it has a **footer** — Reset to
  defaults on the left, Cancel + Save on the right (`SettingsFooter`, using the
  `Button` primitive) — and the appearance settings it owns (theme, font, the
  Editor controls, the achievements switch) edit a local **draft** that previews
  live via `setAppearancePreview` and only persists on Save (`commitAppearance`);
  the device-local controls (language, menu-activation, dev mode) and storage
  connections still apply immediately. The mobile section dropdown is
  an inline `absolute` panel with a `fixed inset-0` catch-all to dismiss —
  checklist's `FloatingPanel` was **not** needed for the settings dropdown
  because the panel sits just below the header, within the card.
- **Floating popover** — `src/ui/FloatingPanel.tsx` (portalled, escape +
  outside-click dismissal, auto-flips above when there's no room below) over
  `src/ui/hooks/useFloatingPosition.ts`, `src/ui/hooks/useEscapeKey.ts`, and
  `src/ui/DismissBackdrop.tsx`. Used by the side-menu footer **About** dropdown;
  reuse it for any genuinely positioned popover. `SelectPicker` remains
  un-ported — wrap-radio rows + `SegmentedRow` cover the in-modal pickers.
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
  "Confirm" button rather than a `ConfirmDialog`. The namespace modal's
  appearance edits apply live (no draft/Save) — that's the namespace registry,
  separate from the settings dialog's drafted appearance store.
- **Cloud sync status** — `src/ui/SyncStatus.tsx` (the morphing cloud glyph
  button) and `src/ui/SyncDetailsModal.tsx` (the info dialog), the two
  presentational pieces of checklist's header sync affordance, plus the cloud
  glyph family in `src/ui/icons.tsx` (`Cloud*`/`Spinner`/`Refresh`/
  `ExternalLink`). They read `SaveStatus` from `app/use-notes-sync.ts`. Unlike
  checklist these are **not** wired through the modal-bus / a `*-context`:
  `src/ui/SyncIndicator.tsx` is a thin notes-only orchestrator that owns the
  modal's open state and derives `providerName` (`adapter.label`) and the
  reconnect gesture from `useStorageBackend`, mirroring how `ConflictModal`
  takes `sync` as a prop in `App` rather than going through the bus. Tones
  collapse to notes' 4-hue palette (no `success`/`pipe`/`flag`): accent =
  synced, link = unsaved/offline, danger = error/auth/conflict, muted = busy.
  English strings inlined (no i18n); a "Reload from backend" action is kept
  from notes' prior indicator. The browser backend renders nothing.
- **Undo / redo** — `src/app/use-undo-redo.ts` (the in-memory snapshot
  timeline) and `src/ui/hooks/useUndoRedoShortcuts.ts` (the global
  Cmd/Ctrl+Z keyboard handler), ported near-verbatim from checklist plus the
  `UndoIcon` / `RedoIcon` glyphs in `icons.tsx`. The timeline records whole
  `Snapshot`s with a label; `useNotes` threads `record` through its `commit`
  seam and exposes `undo`/`redo`/`canUndo`/`canRedo`, surfaced as an "Edit"
  section in `SideMenu` and the keyboard shortcut wired in `App`. Two notes
  adaptations: (1) there is **no toast/i18n**, so labels live in the timeline
  for a future "What was undone" surface but nothing announces them today;
  (2) a note's body is typed one keystroke at a time, so `record` takes an
  optional **`mergeKey`** (`edit:<noteId>`) that coalesces a run of edits to
  the same note into a single undo step — without it the per-keystroke
  `update` would flood the 50-entry history *and* leave the timeline head
  stale relative to the document. The reset-on-external-load wiring mirrors
  checklist: `useNotesSync` takes a `resetHistory` ref and calls it after the
  load / reload / conflict-adopt paths so the timeline re-seeds against a
  document that arrived from outside the edit path.
- **Changelog ("What's new") modal** — `src/ui/changelog/`
  (`parse.ts` Keep-a-Changelog parser, `data.ts` inlining `CHANGELOG.md?raw`,
  `feature-docs.ts` glob-inlining `docs/features/*.md`, `render.tsx`,
  `ChangelogModal.tsx`) + `app/modals/ChangelogModalHost.tsx`, opened by the
  `{ kind: "changelog" }` bus command from a `SparklesIcon` "What's new" row in
  `SideMenu`. **Unlike checklist, notes does NOT port `ui/markdown/renderMarkdown.tsx`** —
  it already has one Markdown parser (`domain/markdown.ts`), so `render.tsx`
  reuses `parseInline` / `classifyLines` and only adds the React-node mapping,
  the `feature:<slug>` drill-down button, and the `URL_SAFE` href check. Strings
  are inlined (no i18n). The `TYPE_COLOR` map collapses checklist's
  positive/negative/success slots — which notes dropped — onto
  `accent`/`danger`/`muted`; the bold label text carries the distinction.
- **Achievements** — `src/achievements/` (`catalog.ts`, pure `derive.ts`,
  in-memory `bus.ts`, `useAchievementWatcher.ts`, `glyphs.tsx`, `types.ts`,
  `index.ts`) + `src/ui/achievements/` (`AchievementsMenuItem`, `AchievementsModal`
  tour, `AchievementUnlockModal`) + the two `app/modals/*Host.tsx`, opened by
  `{ kind: "achievements" }` / `{ kind: "achievements-unlock" }`. Key notes
  adaptations vs checklist: (1) **no i18n** — name/condition/learnMore are
  inlined straight into the catalog entries, not looked up by id; (2) **no
  separate `Settings` doc** — the unlock map, unseen queue, and `disable`
  flag live on the synced `Appearance` store (`theme/useTheme.ts`:
  `unlockAchievements` / `clearUnseenAchievements` / `setDisableAchievements`),
  so the `AchState` slice is `appearance`, not `settings`, and trophies travel
  with `settings.json` for free; (3) **no toast** — `onUnlocked` was dropped,
  the lit-trophy badge (driven by `unseenAchievements`) is the only surfacing;
  (4) **no `achievements-context`** — `AchievementsMenuItem` reads
  `useAppearance()` directly (notes' side menu isn't memoised, so the
  budget/checklist context dance to avoid re-rendering a list isn't needed);
  (5) tones collapse onto
  notes' palette (`flag`→`accent`, `pipe`→`link`, `meta`/`success`→
  `muted`/`accent`). Manual unlocks fire `unlock(id)` from the storage backend
  (aliased `unlockAchievement` there — that module already has a passphrase
  `unlock`), `use-notes` (undo), `use-notes-sync` (conflict), `use-nav`
  (hide-button), `SyncIndicator` (reload), and an App effect (install).

### Privacy / clean-URL routing

`main.tsx` does a `location.pathname` suffix switch to mount `PrivacyPage`,
and `vite.config.ts`'s `emitPrivacyAlias` mirrors `index.html` to
`privacy/index.html`. notes has **no SEO system yet** (a deferred OSS_SPEC
item), so unlike checklist this alias does NOT splice per-route
`<title>`/canonical — it's a verbatim copy. Add the splice here when the SEO
scaffolding lands.
