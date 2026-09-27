// The wrapper's two decisions about the page it hosts, as plain values.
//
// Import-free on purpose, like `scriptText.ts`: the root test suite pins both
// against an install with no `expo` in it (`tests/platform/native-shell.test.ts`).

/**
 * Take the service worker out of the picture, once, before the page's own
 * scripts run.
 *
 * The native build is made without one (`VITE_TARGET=native` disables VitePWA),
 * so today there is nothing to remove. This is the guard for the day one slips
 * in: the origin is a fixed `http://localhost:<port>`, so a worker registered
 * by version N of the app would keep answering from its precache after a store
 * update had already unpacked version N+1 into the webroot — an App Store
 * update that changes nothing until the app is deleted and reinstalled. It has
 * to run before the page loads: a worker that already controls the page is
 * answering fetches by the time the document fires `load`.
 *
 * Everything is guarded: a WebView with no `caches` or no `serviceWorker`
 * simply skips it. The trailing `true` is what `injectJavaScript` wants.
 */
export const SERVICE_WORKER_TEARDOWN = `(function () {
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations().then(function (regs) {
        regs.forEach(function (reg) { reg.unregister(); });
      }).catch(function () {});
    }
    if (window.caches && caches.keys) {
      caches.keys().then(function (keys) {
        keys.forEach(function (key) { caches.delete(key); });
      }).catch(function () {});
    }
  } catch (e) {}
})(); true;`;

/**
 * Whether a navigation stays in the WebView. Only the app's own origin and
 * `about:` pages do; everything else — a link in a note, the licence, a
 * provider's page — belongs in the system browser, because App Review expects
 * external links to open externally and a page left inside the WebView has no
 * way back.
 *
 * The origin is compared whole, not as a bare prefix of the URL:
 * `http://localhost:8311` must not admit `http://localhost:83110`. Plain
 * string work rather than `new URL(…).origin`, which React Native's `URL`
 * has not always implemented.
 */
export function staysInApp(url: string, origin: string): boolean {
  if (url.startsWith("about:")) return true;
  if (url === origin) return true;
  const rest = url.startsWith(origin) ? url.charAt(origin.length) : "";
  return rest === "/" || rest === "?" || rest === "#";
}
