---
name: design
description: "Use whenever you are iterating on the look or layout of the notes UI — tuning a CSS rule, building a new dialog, redesigning the note list or the live-preview editor, hunting a mobile-only regression. Walks an edit / reload / screenshot / inspect loop that uses the Read tool to view PNGs inline at every viewport (desktop, mobile, mobile-landscape, tablet). The harness drives the running vite dev server through reusable flows so each iteration only changes the bit that's being designed. Manual playbook — not part of the `maintenance` umbrella."
---

# Iterating on visual design

The app is a local-first, browser-only PWA built in React + Tailwind —
the UI lives entirely under `src/ui/` (presentational components) and
`src/app/` (the shell and views). Most layout bugs only surface at
specific viewports (the docked sidebar on a wide screen vs the drag-out
drawer on a phone, a dialog footer vs the soft keyboard pushing it up,
the live-preview editor's writing column). Looking at the rendered
pixels at every iteration is what makes "tuning the spacing" fast —
without it, the loop is "edit, reload, switch to phone, scroll, sigh,
swap back" and an hour disappears.

This skill ships a small harness at
`.agent/skills/design/screenshot.mjs` that:

- Connects to whatever app server is already running (`npm run dev` on
  port 5173 preferred; falls back to the vite preview server on 4173).
- Spins up Chromium contexts for desktop / mobile / mobile-landscape
  / tablet viewports as needed.
- Drives the UI through a per-iteration **recipe** the agent edits.
- Writes one PNG per viewport to `/tmp/design-<viewport>.png` so the
  next step is just `Read /tmp/design-mobile.png`.

The Read tool renders PNGs inline. That's the whole reason this skill
is fast — you can see every iteration without leaving the session.

> **Prerequisite:** the harness imports `@playwright/test`, which is
> **not** currently a dependency of this repo. Install it once before
> the first run:
>
> ```sh
> npm i -D @playwright/test && npx playwright install chromium
> ```
>
> Nothing else in notes depends on Playwright, so it is left out of
> `package.json` by default. If you'd rather not add it, this skill's
> screenshot loop can't run.

## When to invoke

Invoke whenever you are about to change something visible and you'd
benefit from comparing renders across iterations:

- Tuning padding, gap, radius, colour on a component you can already
  navigate to (the note list, a note card, the editor header, a drawer
  row).
- Building a new dialog / panel and want to confirm it looks right at
  every breakpoint before declaring it done (the settings modal, the
  namespaces dialog, the conflict modal).
- Debugging a mobile-only layout bug a desktop-only test missed (a
  dialog footer pushed up by the soft keyboard, iOS rounded corners,
  `dvh` vs `svh` flicker, the floating menu button's resting edge).
- Verifying a CSS rule or a `theme.css` token actually wins the
  cascade.

Do **not** invoke when:

- The change has no visible surface (pure refactor in `src/domain/`,
  a storage-adapter internal, build config). Type-check and tests are
  the right loop.
- The bug is a behavioural regression with no visual component. Reach
  for `debug-from-logs` instead.
- The visual concern is the home-screen / launcher / browser-tab icon
  (different pipeline — `make icons` regenerates them from
  `public/favicon.svg`).

## Pipeline

```
your code edit
   │
   ▼  vite HMR (already running via `npm run dev`)
   │
   ▼  node .agent/skills/design/screenshot.mjs
   │       ├─ resolves base URL (dev → preview fallback)
   │       ├─ for each --viewports entry:
   │       │     ├─ open Chromium context with that viewport
   │       │     ├─ run `recipe(page, viewport)` (the editable block)
   │       │     └─ page.screenshot() → /tmp/design-<viewport>.png
   │       └─ prints the written paths to stdout
   │
   ▼  Read /tmp/design-desktop.png  /tmp/design-mobile.png
   │
   └── inspect, decide, loop
```

`recipe(page, viewport)` is the only block you edit between
iterations. It's a `function(page, viewport)` near the bottom of the
script with a clear `// === RECIPE ===` banner around it. Everything
above is reusable plumbing.

## The iteration loop

1. **Boot the dev server once.** Vite HMR makes reloads ~100ms after
   the first warm-up.

   ```sh
   npm run dev &
   ```

   If `npm run dev` is already running, skip this step.

2. **Edit the recipe** at the bottom of
   `.agent/skills/design/screenshot.mjs`. The default recipe opens a
   fresh note and types some Markdown into the live-preview editor —
   replace it with the flow that lands on the state you want to see.
   Use the exported helpers (`openApp`, `openSettings`, …) instead of
   re-clicking through the chrome.

3. **Edit the code you're designing** under `src/ui/` (or `src/app/`
   for the shell and views, `src/styles/theme.css` for tokens).
   Single targeted change per iteration — a diff that touches three
   CSS rules at once makes it hard to tell which one moved the
   screenshot.

4. **Run the harness.**

   ```sh
   node .agent/skills/design/screenshot.mjs --viewports desktop,mobile
   ```

   Vite HMR has already shipped the edit to the running tab; the
   fresh Chromium context just opens to the current state. No
   rebuild step.

5. **Read the PNGs.**

   ```
   Read /tmp/design-desktop.png
   Read /tmp/design-mobile.png
   ```

6. **Adjust and repeat.** Two to four iterations from a clean
   starting point is usually enough. If you're past six iterations on
   the same component, the source design probably wants restructuring
   (split into two components, change the layout primitive, swap the
   responsive strategy) instead of another nudge to the same rule.

## CLI flags

All flags are optional.

| Flag                 | Default          | What it does                                                                                                                                                                                                                                                  |
| -------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--base-url <url>`   | auto-detect      | Where the app is served. Defaults to `http://localhost:5173/` (vite dev) and falls back to `http://localhost:4173/` (vite preview) when 5173 is silent. Pass an explicit URL to target a deployed slot.                                                       |
| `--out <dir>`        | `/tmp`           | Output directory for the PNGs.                                                                                                                                                                                                                                |
| `--name <prefix>`    | `design`         | Filename prefix. Useful when iterating on two screens in parallel (`--name dialog-foo` vs `--name list-bar`).                                                                                                                                                 |
| `--viewports <list>` | `desktop,mobile` | Comma-separated subset of `desktop`, `mobile`, `mobile-landscape`, `tablet`. Skip the ones you don't need so the loop stays under a couple of seconds. Mobile viewports always write `fullPage: false` (one-screen capture); desktop writes the full content. |

## Available helpers

All exported from `screenshot.mjs`. Import them at the top of a
custom recipe (or just reference them — the recipe runs in the same
file so they're in scope).

| Helper                | What it does                                                                                                                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openApp(page)`       | Navigate to the app root and wait until the `Notes` wordmark heading (capital N, from `src/app/App.tsx`) is rendered. The default local backend has no auth / unlock gate — `src/app/main.tsx` mounts straight into the shell — so this is the universal first step of every recipe.                                       |
| `openSettings(page)`  | Open the settings modal: open the side navigation drawer ("Open menu"), then pick "Settings" from the burger menu pinned at its foot. Verified against `src/ui/SideMenu.tsx` and `src/ui/settings/` — the menu items carry `role="menuitem"`, not `button`. On wide (pinned-sidebar) viewports the drawer is always docked, so the helper skips the opener when it isn't present. |

When the helper set is missing something your recipe needs (opening
the namespaces dialog, seeding a note through `localStorage` before
first paint, picking a storage backend), add it to the HELPERS block of
`screenshot.mjs` so the next agent gets it for free (and update the
table above + the **Skill self-improvement** section).

## Recipe patterns

### "I just want to see the app shell"

```js
async function recipe(page) {
  await openApp(page);
}
```

### "I'm tuning the live-preview editor"

```js
async function recipe(page) {
  await openApp(page);
  await page.getByRole("button", { name: /^new note$/i }).first().click();
  await page.keyboard.type("# Heading\n\nSome **bold** body text.");
}
```

### "I'm tuning the settings modal chrome"

```js
async function recipe(page) {
  await openApp(page);
  await openSettings(page);
}
```

### "I want both light and dark mode side-by-side"

Run the harness twice with `--name design-light` / `--name design-dark`
and toggle the theme inside the recipe — the theme engine in
`src/theme/` projects the chosen preset onto `<html data-theme>`, which
the `src/styles/theme.css` tokens key off, so setting the appearance
preference in `localStorage` before the first navigation flips it.
Keeping the two runs separate makes the diff between them obvious in
the Read output.

## Common pitfalls

The trip-ups worth flagging, in roughly descending order of
recurrence:

1. **Forgot to start the dev server.** The harness errors out with a
   pointer to `npm run dev` / `npm run preview`. Boot it once at the
   start of the session and leave it running.
2. **Playwright isn't installed.** The script imports
   `@playwright/test`, which is not a default dependency — see the
   prerequisite note above. The import error is the tell.
3. **Recipe forgets to `await` an interaction.** A bare promise
   means the next step races; the PNG sometimes captures the right
   state and sometimes doesn't. Always `await` every helper call.
4. **CSS rule "looks fine" but isn't winning the cascade.** Reading
   the computed style in the Chromium devtools the recipe leaves the
   context open in is the fastest way to confirm.
5. **Viewport mismatch with media queries.** Confirm the breakpoint
   you're tuning against in `src/ui/` / `src/styles/` matches one of
   the harness viewports; the `mobile` context is `390 × 844`, and the
   side menu docks as a pinned sidebar from the tablet width up. If you
   add a custom viewport in a band the media query doesn't cover, the
   rules you're tuning won't apply.
6. **Strict-mode locator violations in a recipe.** Every accessible-
   name match must be unique. There are two "New note" controls (the
   list FAB and the drawer's "+"), so the default recipe uses
   `.first()`; when two controls share a name, filter further with
   `.filter({ hasText: ... })` or pick a different aria-distinguishable
   element.

## Verification

A loop is "done" when:

- The PNG at every required viewport matches the intended design.
- The same code path looks right at the _next_ breakpoint up (the
  desktop edit didn't accidentally regress mobile, or vice versa).
- The change passes `make lint` and `make test`; the visual signal in
  the screenshots is not a substitute for the lint/test gates.
- If the change is a user-visible UI change, a `.changes/unreleased/`
  fragment records it — see the `write-changeset` skill for whether
  this change needs a fragment or a `no-changelog` label. If it
  touches what data the app reads/writes or an OAuth scope, also update
  `src/ui/HomePage.tsx` (and `PrivacyPage.tsx`) per `AGENTS.md`.

## Skill self-improvement

After a run:

1. If the recipe needed a helper that wasn't in the script, add it
   to the HELPERS block and document it in the table above so the
   next agent doesn't reinvent it. Common candidates: opening the
   namespaces dialog, seeding a note, picking a storage backend.
2. If a selector drifted (the wordmark text changed, a menu item was
   renamed, the "New note" control moved), fix the affected helper and
   the recipe patterns so the next loop starts from current truth.
3. If a new viewport mattered for the bug (foldable phone, ultrawide
   desktop, a specific narrow band where a media query flips), add it
   to `VIEWPORTS` and mention the breakpoint context in this skill.
4. If `--base-url` had to point at a deployed slot (preview, prod)
   and the script's fallback chain didn't anticipate that, extend
   `resolveBaseUrl` and update the CLI flags table.
5. Commit the skill edit alongside the design edit so the next loop
   starts from current truth.
