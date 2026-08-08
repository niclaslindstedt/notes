// Application entry point. Imports the global stylesheet plus the default
// webfont (JetBrains Mono — the `mono` family and the base of the stack)
// statically so it lands in the main bundle and is precached for offline first
// paint. Per the local-first invariant, no font is fetched from a CDN at
// runtime.
//
// Everything else is reached through a dynamic `import()`, on purpose: this
// module resolves the route *first* and then downloads only that route's code.
// The three routes are genuinely disjoint surfaces, and the two public ones
// are the crawlable, log-in-free pages — so `/home` and `/privacy` load a few
// kB of page instead of the entire note-taking app they never mount. See "The
// public pages" in AGENTS.md.

import { createRoot } from "react-dom/client";

import "../styles.css";
// Only the latin + latin-ext subsets ship — the UI text lives entirely
// within them, so the bare entrypoint (which also pulls cyrillic / greek /
// vietnamese) would be pure waste.
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-ext-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "@fontsource/jetbrains-mono/latin-ext-700.css";

const rootEl = document.getElementById("app");
if (!rootEl) throw new Error("missing #app mount point");
const root = createRoot(rootEl);

// Trivial path-based switch. The build emits `dist/privacy/index.html` and
// `dist/home/index.html` (see the `emit-privacy-alias` / `emit-home-alias`
// plugins in `vite.config.ts`) so GitHub Pages serves the same SPA at
// `/privacy/` and `/home/`, and these checks decide which view to mount.
// Deploy slots nest the pages one segment deeper (`/preview/privacy/`,
// `/preview/home/`); the suffix checks match both.
const path = window.location.pathname.replace(/\/$/, "");

// The standalone `/privacy` and `/home` pages are crawlable, English-only
// surfaces (the privacy policy and the Google-verification showcase), so they
// render outside `LanguageRoot` and aren't translated. They render no state
// and can't throw, so they need no error boundary either — which is why each
// is a bare `render` rather than going through `mountApp`.
if (path.endsWith("/privacy")) {
  void import("../ui/PrivacyPage.tsx").then(({ PrivacyPage }) => {
    root.render(<PrivacyPage />);
  });
} else if (path.endsWith("/home")) {
  void import("../ui/HomePage.tsx").then(({ HomePage }) => {
    root.render(<HomePage />);
  });
} else {
  // Developer fake-data seeding. The `VITE_SEED` flag is set only by the
  // `dev:seed` / `build:seed` npm scripts, so in every ordinary build this
  // condition folds to `false` at compile time and the dataset — all 7 kB of
  // it — is dropped from the bundle rather than shipped and never run. When
  // the flag *is* set, the seed lands before the app mounts so the local
  // backend's first synchronous load already sees the seeded document.
  const seeded = import.meta.env.VITE_SEED
    ? import("../dev/seed.ts").then((m) => m.maybeSeedDevData())
    : Promise.resolve();
  void seeded
    .then(() => import("./mount-app.tsx"))
    .then(({ mountApp }) => mountApp(root));
}
