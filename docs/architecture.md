# Architecture

`notes` is a TypeScript Progressive Web App that runs entirely in the browser
and is served as static files. There is **no backend**. It is built with Vite,
Preact, and Tailwind, and uses `vite-plugin-pwa` for the service worker and web
app manifest.

## Layering

The source tree under `src/` is organized by concern. The dependency direction
is strict and enforced by eslint:

```
app  ──▶  ui  ──▶  domain
 │                   ▲
 └──▶  storage  ─────┘
```

- **`src/domain/`** — pure functions over the note model (`note.ts`). No DOM,
  no I/O, no imports from `ui/`, `storage/`, or `app/`. This is the layer the
  planned React Native app reuses unchanged, which is exactly why the boundary
  is enforced rather than merely encouraged.
- **`src/storage/`** — persistence. `local.ts` reads and writes the whole note
  list to `localStorage` under the versioned key `notes/v1`, validating the
  shape defensively on read. It depends only on `domain/`. A synced or
  IndexedDB backend would implement the same load/save pair behind this seam.
- **`src/theme/`** — `useTheme.ts` is a small external store that projects the
  chosen preset onto `<html data-theme>` and persists it to `localStorage`.
  The persisted appearance is **not one document**: it resolves from three
  sparse layers — global, namespace, device — because a namespace can be shared
  by several people through one login, and a single account-wide settings file
  would mean one of them repainting everyone else's app. `appearance-scopes.ts`
  binds the widths to `Appearance` over the pure layer algebra in
  `src/domain/settings-layers.ts`; `useTheme.ts` holds the layers, resolves
  them, and is the only place that writes them, so every consumer keeps reading
  one flat `Appearance`.
- **`src/styles/`** — `theme.css` defines the CSS-variable token vocabulary
  (`--page-bg`, `--surface`, `--fg`, `--accent`, …) and the dark/light/system
  palettes the tokens resolve to.
- **`src/pwa/`** — `usePwaUpdate.ts` registers the service worker via
  `workbox-window` and drives the prompt-style update lifecycle;
  `standalone.ts` detects the installed-PWA-on-mobile context.
- **`src/ui/`** — presentational components (e.g. `UpdateToast.tsx`).
- **`src/app/`** — `App.tsx` (the list ↔ editor shell), `main.tsx` (the entry
  point), and `use-notes.ts` (the store hook the component tree binds to).

Below all of these sits **`@niclaslindstedt/oss-framework`** (GitHub
Packages; `.npmrc` + `GITHUB_PAT`), the shared package extracted from
`notes` and `checklist`. Generic UI primitives, gesture/keyboard hooks, the
PWA update lifecycle, the changelog/achievements/namespaces dialogs, and
the glyph kit are consumed from it; each replaced module keeps its
historical path in `src/` as a re-export shim or a label-injecting wrapper.
One hard rule rides on top of the layering: **nothing in the transitive
import closure of the modules the React Native app shares**
(`src/i18n/index.ts`, `src/domain/note.ts`, `src/storage/adapter.ts`,
`src/storage/namespaces.ts`, `src/app/use-notes.ts`) **may import from the
framework package** — the Expo project installs neither it nor
`react-dom`. AGENTS.md's "The shared framework" section lists what stays
app-side and why (theme fork, encryption envelope compatibility, the
native closure, diverged parser/sync/search surfaces).

## State and persistence

`use-notes.ts` holds the note list in Preact state and persists every change to
`localStorage` via the storage layer. The list view shows non-blank notes
newest-first; the full list (including a freshly created blank note) is exposed
so the editor can resolve a note that isn't in the visible list yet. A note
left blank discards itself when its editor closes.

### Where each settings width lives

| Width       | Home                                              | Reaches                              |
| ----------- | ------------------------------------------------- | ------------------------------------ |
| `global`    | `settings.json` at the app-folder root            | everyone on the account              |
| `namespace` | `namespace-settings.json` in the namespace folder | everyone who uses that namespace     |
| `device`    | `localStorage` only, never uploaded               | this install                         |

Narrowest wins. Each layer is sparse — leaves, not whole groups — so an
override at one width leaves every other setting following the wider layers.
The `device` width is what makes a shared login usable: it is the one place a
person's choices cannot reach anyone else.

Two locks are **per namespace** for the same reason: at-rest encryption (its
mode, passphrase, and `locked` flag all keyed by slug in `useEncryption`) and
the namespace PIN (a PBKDF2 verifier on the registry entry). Either can gate
the active namespace without touching the others, and both full-screen gates
carry a switcher to another namespace so one person's lock never strands
anyone.

## PWA update model

The build emits `dist/sw.js` (workbox precache), `dist/version.json` (the
build label), and `dist/precache-manifest.json` (asset → byte-size map). The
service worker is registered with `updateViaCache: "none"` and uses the
**prompt** strategy: a new build installs and parks in the `waiting` state,
`UpdateToast` surfaces a Reload button, and the page only swaps to the new
JS when the user clicks it — never silently mid-edit.

## Build-time injection

`vite.config.ts` injects `__APP_VERSION__` and `__BUILD_LABEL__` (re-exported
typed from `src/build-env.ts`) and runs two small plugins to emit
`version.json` and `precache-manifest.json`. The base path comes from
`VITE_BASE` so one bundle deploys to any subpath.

## What's intentionally not here yet

This repo is a focused scaffold. The fuller machinery from `checklist` — the
multi-palette theme engine and custom-theme editor, modals and the side menu,
cloud-sync storage backends, the marketing `website/`, full SEO prerendering,
and the release pipeline — is brought over incrementally via the
`copy-feature` agent skill, adapted to the notes domain rather than pasted.
