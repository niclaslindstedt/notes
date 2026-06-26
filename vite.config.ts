import { readFileSync, statSync, writeFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig, type Plugin } from "vitest/config";

// The GitHub Pages base path is injected by the `pages.yml` workflow via
// VITE_BASE so the same bundle works at `/`, `/preview/`, or `/branch/`.
// Production serves at `/` under the custom domain (see `public/CNAME`).
const base = process.env.VITE_BASE ?? "/";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

// Short build identifier surfaced next to the header wordmark and in the
// update prompt so you can tell at a glance which build is running. Shape:
// `<pkg.version>[.<run>][-<slot>][+<commit>]`:
//
//   - `<run>`    — the GitHub Actions run number (omitted locally).
//   - `<slot>`   — `pre` for the `/preview/` slot, `br` for `/branch/`,
//                  omitted for the production `/` slot.
//   - `<commit>` — the short `GITHUB_SHA` as build metadata after the `+`.
const GITHUB_RUN_NUMBER = process.env.GITHUB_RUN_NUMBER;
const COMMIT_HASH = (process.env.GITHUB_SHA ?? "").slice(0, 7);
const BUILD_SLOT =
  base === "/preview/" ? "pre" : base === "/branch/" ? "br" : "";
const BUILD_LABEL =
  pkg.version +
  (GITHUB_RUN_NUMBER ? `.${GITHUB_RUN_NUMBER}` : "") +
  (BUILD_SLOT ? `-${BUILD_SLOT}` : "") +
  (COMMIT_HASH ? `+${COMMIT_HASH}` : "");

// Per-slot Workbox precache cache id. The three Pages slots share one
// origin, so a slot-specific id keeps each deploy's precache cache
// (`<cacheId>-precache-v2-<scope>`) distinct — the download-progress
// tracker in `usePwaUpdate` opens this slot's cache by name to measure
// install progress without counting another slot's bytes. Must stay in
// sync with `cacheIdForBase` in `src/pwa/usePwaUpdate.ts`.
const CACHE_ID =
  base === "/preview/"
    ? "notes-preview"
    : base === "/branch/"
      ? "notes-branch"
      : "notes";

// Per-slot PWA display name so the preview and branch slots install as
// visibly separate apps on the home screen rather than three identically
// named "Notes" tiles. The W3C identity (`id`/`scope`/`start_url`) is
// already per-slot below; this just labels the tile to match.
const PWA_NAME =
  base === "/preview/"
    ? "Notes (preview)"
    : base === "/branch/"
      ? "Notes (branch)"
      : "Notes";
const PWA_SHORT_NAME =
  base === "/preview/"
    ? "Notes pre"
    : base === "/branch/"
      ? "Notes br"
      : "Notes";

// Keep each slot's service worker inside its own base path. The default
// `navigateFallback` (index.html for any in-scope navigation) means the
// production SW, scoped to `/`, would otherwise claim `/preview/` and
// `/branch/` navigations and serve the production app shell at those
// URLs — so a PWA installed from `/preview/` silently runs production.
// The slot patterns also match the slash-less `/preview` / `/branch`
// spellings: GitHub Pages 301-redirects those to the trailing-slash URL,
// but the SW intercepts the navigation before the network. Workbox tests
// these against `url.pathname + url.search`, hence the `\?` alternative.
// A non-root build denies everything outside its own base.
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NAVIGATE_FALLBACK_DENYLIST =
  base === "/"
    ? [/^\/preview(?:\/|\?|$)/, /^\/branch(?:\/|\?|$)/]
    : [new RegExp(`^/(?!${escapeRegex(base.slice(1))})`)];

// Emit `dist/version.json` so the still-active old service worker can tell
// the client which version is incoming when a new build deploys (read
// cache-bypassed by `usePwaUpdate` on the workbox `waiting` event).
function emitVersionJson(): Plugin {
  return {
    name: "emit-version-json",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version: BUILD_LABEL }) + "\n",
      });
    },
  };
}

// Emit a `precache-manifest.json` listing every precached asset and its
// byte size so `usePwaUpdate` can render a real download-progress fill
// (it sums the bytes of cached entries against this total). Runs in
// `closeBundle`, after VitePWA (`enforce: "post"`) has written `dist/sw.js`
// with the workbox precache list inlined.
function emitPrecacheManifest(): Plugin {
  return {
    name: "emit-precache-manifest",
    apply: "build",
    enforce: "post",
    closeBundle() {
      const distDir = fileURLToPath(new URL("./dist/", import.meta.url));
      let sw: string;
      try {
        sw = readFileSync(`${distDir}sw.js`, "utf8");
      } catch {
        // No SW emitted (e.g. PWA disabled) — nothing to summarise.
        return;
      }
      // vite-plugin-pwa inlines the workbox precache list as
      // `self.__WB_MANIFEST` resolved to `[{url, revision}, ...]`.
      const urls = new Set<string>();
      for (const m of sw.matchAll(/"(?:revision":[^}]*?)?url":"([^"]+)"/g)) {
        if (m[1]) urls.add(m[1]);
      }
      for (const m of sw.matchAll(/url:"([^"]+)"/g)) {
        if (m[1]) urls.add(m[1]);
      }
      const assets: Record<string, number> = {};
      let totalBytes = 0;
      for (const url of urls) {
        const clean = url.split("?")[0] ?? url;
        const path = clean.startsWith("/") ? clean.slice(1) : clean;
        try {
          const size = statSync(`${distDir}${path}`).size;
          assets[clean.startsWith("/") ? clean : `/${clean}`] = size;
          totalBytes += size;
        } catch {
          // Listed in the manifest but absent on disk — skip it.
        }
      }
      writeFileSync(
        `${distDir}precache-manifest.json`,
        JSON.stringify({ totalBytes, assets }) + "\n",
      );
    },
  };
}

// Mirror the built `index.html` to `privacy/index.html` so GitHub Pages
// serves the SPA from the clean URL `/privacy/` (and `/preview/privacy/`,
// …). The app's `main.tsx` reads `location.pathname` and mounts the
// privacy page there; the copied HTML loads the same hashed asset URLs
// (they are origin-absolute), so no rewrite is needed. Runs late
// (`enforce: "post"`) so the PWA plugin's manifest-link injection is
// already baked into the source. When the SEO scaffolding lands (§11.2/3)
// this is where a per-route <title>/canonical splice would slot in.
function emitPrivacyAlias(): Plugin {
  return {
    name: "emit-privacy-alias",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const index = bundle["index.html"];
      if (index && index.type === "asset") {
        this.emitFile({
          type: "asset",
          fileName: "privacy/index.html",
          source: String(index.source),
        });
      }
    },
  };
}

// Mirror the built `index.html` to `home/index.html` so GitHub Pages serves
// the SPA from the clean URL `/home/` (and `/preview/home/`, …). This is the
// public showcase / landing page (`ui/HomePage.tsx`) — the surface Google's
// OAuth verification reviewer reaches without signing in. Works exactly like
// `emit-privacy-alias`: `main.tsx` reads `location.pathname` and mounts the
// home page there, and the copied HTML loads the same origin-absolute hashed
// asset URLs, so no rewrite is needed.
function emitHomeAlias(): Plugin {
  return {
    name: "emit-home-alias",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const index = bundle["index.html"];
      if (index && index.type === "asset") {
        this.emitFile({
          type: "asset",
          fileName: "home/index.html",
          source: String(index.source),
        });
      }
    },
  };
}

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // `UpdateToast` registers the SW itself via `workbox-window` (so it
      // can pass `updateViaCache: "none"`) and the new build parks in the
      // `waiting` state until the user clicks Reload — no silent swap, no
      // auto-injected `<script>`.
      registerType: "prompt",
      injectRegister: null,
      includeAssets: [
        "favicon.svg",
        "favicon.ico",
        "apple-touch-icon-180x180.png",
      ],
      manifest: {
        id: base,
        scope: base,
        start_url: base,
        name: PWA_NAME,
        short_name: PWA_SHORT_NAME,
        description:
          "A local-first PWA for taking notes that works great on mobile and desktop.",
        theme_color: "#1f2933",
        background_color: "#1f2933",
        display: "standalone",
        orientation: "any",
        lang: "en",
        categories: ["productivity", "utilities"],
        // Generated by `make icons` from `public/favicon.svg`; see
        // `pwa-assets.config.ts`. Keep in sync with the PNGs under `public/`.
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        cacheId: CACHE_ID,
        // Precache the app shell: JS, CSS, fonts, icons, and the HTML
        // entry. Source maps stay on the network.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webp,woff2}"],
        globIgnores: ["**/*.map"],
        cleanupOutdatedCaches: true,
        // Serve the precached app shell for any in-scope navigation so the
        // app opens offline / on a deep link. The data JSON files are read
        // cache-bypassed by `usePwaUpdate`, so keep them off the fallback;
        // the slot patterns keep this slot's SW from claiming another
        // slot's navigations (see NAVIGATE_FALLBACK_DENYLIST above).
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [
          /version\.json$/,
          /precache-manifest\.json$/,
          ...NAVIGATE_FALLBACK_DENYLIST,
        ],
      },
    }),
    emitVersionJson(),
    emitPrecacheManifest(),
    emitPrivacyAlias(),
    emitHomeAlias(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_LABEL__: JSON.stringify(BUILD_LABEL),
  },
  test: {
    // Domain/storage tests run in node. UI tests opt into jsdom with a
    // `// @vitest-environment jsdom` docblock at the top of the file.
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}"],
    // Inline the framework so Vite transforms its dynamic `@fontsource/*.css`
    // imports (in the theme font loaders). Left external, Vitest hands those
    // to Node's native ESM loader, which throws `ERR_UNKNOWN_FILE_EXTENSION`
    // on `.css` — a test reaching the loaders would fail even though it
    // "passes".
    server: { deps: { inline: ["@niclaslindstedt/oss-framework"] } },
  },
});
