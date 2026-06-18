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
import { App } from "./App.tsx";

const root = document.getElementById("app");
if (!root) throw new Error("missing #app mount point");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
