// Application entry point. Mounts the React tree and imports the global
// stylesheet plus the default webfont (JetBrains Mono — the `mono` family
// and the base of the stack) statically so it lands in the main bundle and
// is precached for offline first paint. Per the local-first invariant, no
// font is fetched from a CDN at runtime.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../styles.css";
// Only the latin + latin-ext subsets ship — the UI text lives entirely
// within them, so the bare entrypoint (which also pulls cyrillic / greek /
// vietnamese) would be pure waste.
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-ext-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "@fontsource/jetbrains-mono/latin-ext-700.css";
import { LanguageRoot } from "../i18n/LanguageRoot.tsx";
import { HomePage } from "../ui/HomePage.tsx";
import { PrivacyPage } from "../ui/PrivacyPage.tsx";
import { App } from "./App.tsx";

const root = document.getElementById("app");
if (!root) throw new Error("missing #app mount point");

// Trivial path-based switch. The build emits `dist/privacy/index.html` and
// `dist/home/index.html` (see the `emit-privacy-alias` / `emit-home-alias`
// plugins in `vite.config.ts`) so GitHub Pages serves the same SPA at
// `/privacy/` and `/home/`, and these checks decide which view to mount.
// Deploy slots nest the pages one segment deeper (`/preview/privacy/`,
// `/preview/home/`); the suffix checks match both.
const path = window.location.pathname.replace(/\/$/, "");
const isPrivacy = path.endsWith("/privacy");
const isHome = path.endsWith("/home");

// The standalone `/privacy` and `/home` pages are crawlable, English-only
// surfaces (the privacy policy and the Google-verification showcase), so they
// render outside `LanguageRoot` and aren't translated. Only the app shell is
// wrapped, so it picks up the active language and the first-paint gate.
createRoot(root).render(
  <StrictMode>
    {isPrivacy ? (
      <PrivacyPage />
    ) : isHome ? (
      <HomePage />
    ) : (
      <LanguageRoot>
        <App />
      </LanguageRoot>
    )}
  </StrictMode>,
);
