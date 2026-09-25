// Propagates the web app's resolved theme out to the native chrome, so the
// status bar and the background behind the WebView follow the page instead of
// a hardcoded dark constant and the system appearance.
//
// On iOS the WebView runs edge to edge (see `WebViewHost.tsx`), so the page's
// own background sits under the status bar. A status bar styled from the
// system appearance ("auto") then draws dark icons over a dark theme — or
// light icons over a light one — whenever the two disagree, which is invisible.
//
// The web app already computes the colours — `html`/`body` paint
// `var(--page-bg)`, overridden per `data-theme` (and inline for the Custom
// theme) by `../../src/styles/`. So this does not recompute anything; it reads
// that custom property off `<html>` and reports it to native. A
// `MutationObserver` on the `data-theme`/`style` attributes re-reports when the
// theme is switched live from settings, so the native chrome tracks the change
// without a reload.
//
// A one-way, page→native channel: it rides the same
// `window.ReactNativeWebView.postMessage` transport as the bridge but tags its
// messages `__notesTheme`, so the bridge's handlers ignore them and this one
// ignores theirs.

import { useCallback, useMemo, useState } from "react";
import type { WebViewMessageEvent } from "react-native-webview";

/** The native chrome derived from the web app's active theme. */
export interface NativeTheme {
  /** The resolved page background, as a CSS `rgb(...)` string RN accepts. */
  background: string;
  /**
   * Status-bar content style: `"light"` (white icons) over a dark background,
   * `"dark"` (dark icons) over a light one — chosen from the background's
   * perceived luminance so the icons stay legible on every preset.
   */
  barStyle: "light" | "dark";
}

/**
 * Build the JS injected into the page after it loads. Reads `--page-bg` off
 * `<html>`, resolves the background to concrete `rgb()` via the
 * browser (the vars may hold hex, named, or `rgb()` colours), picks a
 * status-bar style from its luminance, and posts the pair to native — once
 * immediately and again on every theme switch. Idempotent: a re-injection
 * (e.g. after the page reloads) re-uses the installed
 * reporter rather than stacking a second observer.
 */
export function buildInjectedThemeReporter(): string {
  return `(function () {
  if (window.__notesThemeReporterInstalled) return;
  window.__notesThemeReporterInstalled = true;
  var last = null;
  function resolveColor(value) {
    // Let the browser normalise whatever the var holds into "rgb(r, g, b)".
    var probe = document.createElement("span");
    probe.style.color = value;
    probe.style.display = "none";
    document.body.appendChild(probe);
    var out = getComputedStyle(probe).color;
    document.body.removeChild(probe);
    return out;
  }
  function report() {
    try {
      var raw = getComputedStyle(document.documentElement)
        .getPropertyValue("--page-bg").trim();
      if (!raw) return;
      var css = resolveColor(raw);
      var m = css.match(/rgba?\\(([^)]+)\\)/);
      if (!m) return;
      var p = m[1].split(",").map(function (n) { return parseFloat(n); });
      // Perceived luminance (Rec. 601 luma), 0..1. Dark bg -> light icons.
      var lum = (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) / 255;
      var payload = JSON.stringify({
        __notesTheme: true,
        background: css,
        barStyle: lum < 0.5 ? "light" : "dark"
      });
      if (payload === last) return;
      last = payload;
      window.ReactNativeWebView.postMessage(payload);
    } catch (e) {}
  }
  report();
  try {
    var obs = new MutationObserver(report);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style"]
    });
  } catch (e) {}
  // The "system" theme follows prefers-color-scheme via CSS media queries,
  // which change --page-bg without mutating any <html> attribute — so the
  // observer above never sees an OS light/dark toggle. Catch it directly.
  try {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq.addEventListener) mq.addEventListener("change", report);
    else if (mq.addListener) mq.addListener(report);
  } catch (e) {}
  // A backgrounded-then-foregrounded page can miss an attribute mutation.
  document.addEventListener("visibilitychange", report);
})();
true;`;
}

/**
 * Parse a WebView message as a theme report. Returns the `NativeTheme` for our
 * own `__notesTheme` messages and `null` for anything else (bridge
 * traffic, malformed JSON), so the caller can fall through to other handlers.
 */
export function parseThemeMessage(data: string): NativeTheme | null {
  let msg: unknown;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (
    typeof msg !== "object" ||
    msg === null ||
    (msg as { __notesTheme?: unknown }).__notesTheme !== true
  ) {
    return null;
  }
  const record = msg as { background?: unknown; barStyle?: unknown };
  if (typeof record.background !== "string") return null;
  return {
    background: record.background,
    barStyle: record.barStyle === "dark" ? "dark" : "light",
  };
}

/**
 * Native side of the theme channel. Returns the script to inject, the current
 * theme (until the page reports one, `null` — the caller falls back to its
 * startup constant), and a message handler that consumes theme reports and
 * signals whether it handled the event so the bridge handler can take the
 * rest.
 */
export function useNativeTheme(): {
  injectedJavaScript: string;
  theme: NativeTheme | null;
  onThemeMessage: (event: WebViewMessageEvent) => boolean;
} {
  const [theme, setTheme] = useState<NativeTheme | null>(null);
  const injectedJavaScript = useMemo(() => buildInjectedThemeReporter(), []);

  const onThemeMessage = useCallback((event: WebViewMessageEvent): boolean => {
    const next = parseThemeMessage(event.nativeEvent.data);
    if (!next) return false;
    setTheme((prev) =>
      prev &&
      prev.background === next.background &&
      prev.barStyle === next.barStyle
        ? prev
        : next,
    );
    return true;
  }, []);

  return { injectedJavaScript, theme, onThemeMessage };
}
