import { Component, type ErrorInfo, type ReactNode } from "react";

import { createLogger } from "../dev/logger.ts";
import { useT } from "../i18n/index.ts";
import { Button } from "./form/Button.tsx";
import { RestoreIcon } from "./icons.tsx";

const log = createLogger("crash");

// The app's last line of defence, wrapped around the whole shell in `main.tsx`.
//
// React unmounts the entire root when a render throws and nothing catches it,
// which on a PWA leaves a blank page with no way back — the only recovery is
// force-quitting the app and launching it cold. That is a harsh punishment for
// any single bug, and this surface exists so a crash costs a button press
// instead. It is not a substitute for not crashing: a caught error is still a
// defect, which is why it goes to the in-app log.
//
// The crash is logged rather than written to the console because the console
// is exactly what the user can't reach on the device this matters most on (see
// `dev/logger.ts`). The entry survives the reload, so a phone-only crash can be
// read back from Settings → Logs and reported.
//
// Nothing is lost by reloading: the notes are persisted on every edit, so the
// reload re-reads them from the active backend.
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log.error(error.message, error.stack ?? "", info.componentStack ?? "");
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <CrashScreen error={error} />;
  }
}

// The fallback itself, split out as a function component so it can read the
// active language — a class can't call hooks. Mounted inside `LanguageRoot`,
// so a Swedish user gets Swedish; outside it, `useT` falls back to English.
function CrashScreen({ error }: { error: Error }) {
  const t = useT();
  return (
    <div
      role="alert"
      className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg px-6 py-[max(1.5rem,env(safe-area-inset-bottom))] text-center text-fg"
    >
      <h1 className="text-lg font-medium">{t("app.crash.title")}</h1>
      <p className="max-w-sm text-sm text-muted">{t("app.crash.body")}</p>
      <Button
        variant="primary"
        className="inline-flex shrink-0 items-center gap-1.5"
        onClick={() => window.location.reload()}
      >
        <RestoreIcon className="h-4 w-4" />
        {t("app.crash.reload")}
      </Button>
      {/* Collapsed by default: the message is for the user, the stack is for
          the bug report they might file. */}
      <details className="max-w-full text-left">
        <summary className="cursor-pointer text-xs text-muted">
          {t("app.crash.details")}
        </summary>
        <pre className="mt-2 max-w-full overflow-auto rounded-[var(--radius)] border border-line bg-surface p-3 text-xs whitespace-pre-wrap text-muted">
          {error.stack ?? error.message}
        </pre>
      </details>
    </div>
  );
}
