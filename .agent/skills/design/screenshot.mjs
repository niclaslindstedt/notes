// Iterative design screenshot harness. The `recipe` block at the end
// of this file is the only thing an agent edits per iteration — the
// helpers above are stable building blocks for common app flows.
//
// REQUIRES PLAYWRIGHT (not currently a dependency of this repo). This
// script imports `@playwright/test`, which notes does not yet install.
// Before running this skill, the maintainer must:
//
//   npm i -D @playwright/test && npx playwright install chromium
//
// Nothing else in the repo depends on Playwright, so it is left out of
// `package.json` by default. Add it only if you want this skill to run.
//
// Run:
//
//   npm run dev &                              # leave running in the background
//   node .agent/skills/design/screenshot.mjs   # captures the recipe at every viewport
//
// Then `Read` the PNGs written under /tmp/design-*.png, tweak code,
// rerun. Vite HMR picks up edits without a rebuild so each loop is
// ~1-2s once the dev server is warm.
//
// CLI flags (all optional, sensible defaults):
//
//   --base-url <url>       Where the app is served (default
//                          http://localhost:5173/). Auto-falls back to
//                          the vite preview server when the dev port is
//                          silent.
//   --out <dir>            Output directory (default /tmp).
//   --name <prefix>        Filename prefix (default "design").
//   --viewports <list>     Comma-separated subset of
//                          desktop,mobile,mobile-landscape,tablet
//                          (default desktop,mobile).

import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

// === HELPERS (don't edit — these stay stable across recipes) ===

// Playwright's `newContext` takes `viewport: { width, height }` as a
// nested object — passing `width` / `height` at the top level is a
// silent no-op and lands on the default 1280×720 desktop. Every entry
// here is shaped for direct spread into the context options.
const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 800 } },
  // iPhone 12 viewport — same `390 × 844` Playwright's "iPhone 12"
  // device descriptor exposes, with hasTouch / isMobile flipped so
  // touch interactions work and the mobile media queries match.
  mobile: {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  },
  "mobile-landscape": {
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  },
  // iPad mini portrait — wide enough to render the pinned-sidebar
  // layout but narrow enough that responsive overrides are visible.
  tablet: {
    viewport: { width: 768, height: 1024 },
    hasTouch: true,
    isMobile: true,
  },
};

// Land on the app and wait until the shell has rendered. The default
// local backend has no auth / unlock gate — `src/app/main.tsx` mounts
// straight into the app shell, whose list header renders an `<h1>Notes`
// wordmark (note the capital N — see `src/app/App.tsx`) — so this just
// navigates and waits for that heading before a recipe chains further
// interactions. (The encrypting backend can gate behind an UnlockGate;
// the default local backend does not.)
export async function openApp(page) {
  await page.goto("./");
  await page.getByRole("heading", { name: "Notes", level: 1 }).waitFor();
}

// Open the settings modal. Settings live behind the side navigation
// drawer: open the drawer ("Open menu"), then pick "Settings" from the
// burger menu pinned at its foot. Verified against `src/ui/SideMenu.tsx`
// and `src/ui/settings/` — note the menu items carry `role="menuitem"`,
// not `button`. On wide (pinned) viewports the drawer is always docked,
// so the "Open menu" button isn't present; guard for that if you exercise
// settings at desktop width.
export async function openSettings(page) {
  const opener = page.getByRole("button", { name: /open menu/i });
  if (await opener.count()) {
    await opener.click();
    await page.waitForTimeout(400);
  }
  await page.getByRole("menuitem", { name: /^settings$/i }).click();
  await page.getByRole("dialog").waitFor();
}

// Pop the local `npm run dev` Vite server, or fall back to the built
// preview server if dev is silent. The skill prefers dev for HMR
// speed; preview is the deterministic backup.
async function resolveBaseUrl(explicit) {
  if (explicit) return explicit;
  const candidates = ["http://localhost:5173/", "http://localhost:4173/"];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(750) });
      if (res.ok || res.status === 304) return url;
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    "No app server reachable. Start `npm run dev` (or `make build && npm run preview`) before running this script.",
  );
}

function parseArgs(argv) {
  const args = { out: "/tmp", name: "design", viewports: "desktop,mobile" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf("=");
    const [flag, inline] =
      eq === -1 ? [a, undefined] : [a.slice(0, eq), a.slice(eq + 1)];
    const value = inline ?? argv[++i];
    if (flag === "--base-url") args.baseUrl = value;
    else if (flag === "--out") args.out = value;
    else if (flag === "--name") args.name = value;
    else if (flag === "--viewports") args.viewports = value;
    else throw new Error(`Unknown flag: ${flag}`);
  }
  return args;
}

// === RECIPE (edit this per iteration) ===
//
// `recipe` runs once per viewport. It receives the page already
// pointed at the right base URL but otherwise empty — drive the UI
// however you need, ending in the visual state you want to inspect.
// The harness takes the screenshot for you after this returns.
//
// `viewport` is the key from VIEWPORTS so the recipe can branch on
// breakpoint when needed (e.g. only exercise a mobile-only control).
//
// The default below opens a fresh note and types some Markdown into the
// live-preview editor so you land on the editor surface. Replace it with
// whatever state you're designing — the note list, the settings modal,
// the namespaces dialog. If you only want the app shell, the body is
// just `await openApp(page);`.

async function recipe(page, _viewport) {
  await openApp(page);

  // Start a fresh note (the "New note" FAB / drawer action) and type a
  // little Markdown so the live-preview editor renders formatted lines.
  await page.getByRole("button", { name: /^new note$/i }).first().click();
  await page.waitForTimeout(150);

  // The editor's active line is a textarea; the rest are rendered proxies.
  // Type a heading and a list so the preview shows real formatting.
  await page.keyboard.type("# Shopping list\n");
  await page.keyboard.type("- Milk\n");
  await page.keyboard.type("- **Eggs**\n");
  await page.keyboard.type("- Bread");
  await page.waitForTimeout(200);
}

// === RUN (don't edit) ===

async function main() {
  const args = parseArgs(process.argv);
  const baseURL = await resolveBaseUrl(args.baseUrl);
  if (!existsSync(args.out)) await mkdir(args.out, { recursive: true });
  const viewports = args.viewports.split(",").map((s) => s.trim());
  const browser = await chromium.launch();
  try {
    for (const viewport of viewports) {
      const spec = VIEWPORTS[viewport];
      if (!spec) {
        console.error(
          `Unknown viewport "${viewport}". Known: ${Object.keys(VIEWPORTS).join(", ")}`,
        );
        process.exitCode = 1;
        continue;
      }
      const ctx = await browser.newContext({ baseURL, ...spec });
      const page = await ctx.newPage();
      try {
        await recipe(page, viewport);
        const path = join(args.out, `${args.name}-${viewport}.png`);
        await page.screenshot({
          path,
          fullPage: viewport.startsWith("mobile") ? false : true,
        });
        console.log(path);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
