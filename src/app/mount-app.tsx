// The app shell's mount, split out of `main.tsx` so the entry point can reach
// it through a dynamic `import()`. Everything the note-taking app needs —
// `App`, the storage layer, the i18n runtime, every modal host — hangs off
// this module, so keeping it off the entry's static import graph is what lets
// the crawlable `/home` and `/privacy` pages load without the app behind them.
// See the routing comment in `main.tsx`.

import { StrictMode, type ReactNode } from "react";

import { LanguageRoot } from "../i18n/LanguageRoot.tsx";
import { ErrorBoundary } from "../ui/ErrorBoundary.tsx";
import { App } from "./App.tsx";

// Structurally what `createRoot` returns, named here rather than imported:
// Preact's `react-dom/client` shim exports the factory but no `Root` type, and
// spelling out the one method used keeps this module off the renderer's types.
type AppRoot = { render: (children: ReactNode) => void };

export function mountApp(root: AppRoot): void {
  // The shell is wrapped in `ErrorBoundary` — inside `LanguageRoot` so the
  // fallback speaks the user's language. Without it a throw anywhere in the
  // tree unmounts the root and leaves a blank page that only a cold restart
  // clears. See `ui/ErrorBoundary.tsx`.
  root.render(
    <StrictMode>
      <LanguageRoot>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </LanguageRoot>
    </StrictMode>,
  );
}
