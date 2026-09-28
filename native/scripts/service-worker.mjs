// The phone app ships its web app inside the binary and changes only when the
// store delivers a new build. A service worker in the WebView would go on
// serving the copy it cached after that — so the phone build has none
// (`VITE_TARGET=native` leaves it out), and `bundle-web.mjs` refuses a webroot
// that carries one anyway: a website build copied into `native/web/` and
// re-zipped with `--skip-build`.
//
// What counts is what vite-plugin-pwa writes: the worker itself (`sw.js`), the
// workbox runtime it imports, and the registration helper.

const WORKER = /(^|\/)(sw\.js|workbox-[\w-]+\.js|registerSW\.js)$/;

/** The files in a webroot (forward-slash paths relative to its root) that
 *  make up a service worker, in the order given. Empty for a phone build. */
export function serviceWorkerFiles(paths) {
  return paths.filter((path) => WORKER.test(path));
}
