import { Component, useState, type ErrorInfo, type ReactNode } from "react";

import { createLogger, getLogs, type LogEntry } from "../dev/logger.ts";
import { useT } from "../i18n/index.ts";
import { writeClipboard } from "./clipboard.ts";
import { Button } from "./form/Button.tsx";
import { CheckIcon, CopyIcon, RestoreIcon } from "./icons.tsx";

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
  { error: Error | null; componentStack: string }
> {
  state: { error: Error | null; componentStack: string } = {
    error: null,
    componentStack: "",
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const componentStack = info.componentStack ?? "";
    log.error(error.message, error.stack ?? "", componentStack);
    // Kept on the instance too, so the screen can put it on the clipboard
    // alongside the stack — the component stack is usually the half that says
    // *which* surface threw.
    this.setState({ componentStack });
  }

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    return <CrashScreen error={error} componentStack={componentStack} />;
  }
}

// The fallback itself, split out as a function component so it can read the
// active language — a class can't call hooks. Mounted inside `LanguageRoot`,
// so a Swedish user gets Swedish; outside it, `useT` falls back to English.
//
// Laid out as a fixed, self-scrolling sheet rather than a `min-h-dvh` block in
// document flow. It renders *outside* the app shell (which pins itself to the
// visual viewport), and `html, body` are locked to `overflow: hidden` so the
// document itself never scrolls — so a block taller than the viewport simply
// had its overflow clipped away, taking the error details with it. Pinning to
// the viewport and scrolling inside keeps the whole report reachable, and the
// safe-area padding on all four edges keeps it clear of the notch, the home
// indicator, and the landscape rounded corners the way every modal is.
function CrashScreen({
  error,
  componentStack,
}: {
  error: Error;
  componentStack: string;
}) {
  const t = useT();
  const [copied, setCopied] = useState<null | "ok" | "failed">(null);
  const details = crashDetails(error, componentStack);

  async function handleCopy() {
    const ok = await writeClipboard(crashReport(error, componentStack));
    setCopied(ok ? "ok" : "failed");
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div
      role="alert"
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto overscroll-contain bg-bg pt-[max(1.5rem,env(safe-area-inset-top))] pr-[max(1.5rem,env(safe-area-inset-right))] pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1.5rem,env(safe-area-inset-left))] text-fg"
    >
      {/* `m-auto` rather than `justify-center`: it centres the report while it
          fits and simply stops centring when it doesn't, where a centred flex
          column would push its own top out of the scroll container's reach. */}
      <div className="m-auto flex w-full max-w-lg flex-col items-center gap-4 text-center">
        <h1 className="text-lg font-medium">{t("app.crash.title")}</h1>
        <p className="text-sm text-muted">{t("app.crash.body")}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            variant="primary"
            className="inline-flex shrink-0 items-center gap-1.5"
            onClick={() => window.location.reload()}
          >
            <RestoreIcon className="h-4 w-4" />
            {t("app.crash.reload")}
          </Button>
          {/* The report is no use to anyone stuck inside the device it was
              produced on: without this the only way to file a phone-only crash
              was to transcribe a stack trace off the screen by hand. */}
          <Button
            variant="secondary"
            className="inline-flex shrink-0 items-center gap-1.5"
            onClick={() => void handleCopy()}
          >
            {copied === "ok" ? (
              <CheckIcon className="h-4 w-4" />
            ) : (
              <CopyIcon className="h-4 w-4" />
            )}
            {copied === "ok"
              ? t("app.crash.copied")
              : copied === "failed"
                ? t("app.crash.copyFailed")
                : t("app.crash.copy")}
          </Button>
        </div>
        {/* Collapsed by default: the message is for the user, the stack is for
            the bug report they might file. The details scroll on their own too,
            so a long stack can be read through without the buttons above
            sliding off the top. */}
        <details className="w-full text-left">
          <summary className="cursor-pointer text-xs text-muted">
            {t("app.crash.details")}
          </summary>
          <pre className="mt-2 max-h-[50vh] overflow-auto overscroll-contain rounded-[var(--radius)] border border-line bg-surface p-3 font-mono text-xs break-words whitespace-pre-wrap text-muted">
            {details}
          </pre>
        </details>
      </div>
    </div>
  );
}

// What the disclosure shows: the error itself, then the component stack that
// names the surface it threw in.
function crashDetails(error: Error, componentStack: string): string {
  const head = error.stack ?? `${error.name}: ${error.message}`;
  return componentStack ? `${head}\n${componentStack.trim()}` : head;
}

// What the Copy button puts on the clipboard: the crash, plus the tail of the
// in-app log. The entries leading up to a crash (which backend was loading,
// which save failed) are usually what makes it diagnosable, and they are the
// part the user can't reach — Settings → Logs lives inside the app this screen
// has replaced.
const REPORT_LOG_ENTRIES = 100;

function crashReport(error: Error, componentStack: string): string {
  const parts = [crashDetails(error, componentStack)];
  const entries = getLogs().slice(-REPORT_LOG_ENTRIES);
  if (entries.length > 0) parts.push(entries.map(formatLogLine).join("\n"));
  return parts.join("\n\n");
}

function formatLogLine(entry: LogEntry): string {
  const d = new Date(entry.ts);
  const time = [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  return `${time} [${entry.scope}] ${entry.level.toUpperCase()} ${entry.message}`;
}
