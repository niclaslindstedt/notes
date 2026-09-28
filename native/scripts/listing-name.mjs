// The name the phone app calls itself — its header wordmark and the page
// title — and the rule that it is the listing name.
//
// The web build takes it from `APP_DISPLAY_NAME` (`vite.config.ts` reads it
// for `VITE_TARGET=native` only), and `app.config.js` takes the same variable
// for the name under the icon. Both fall back to the plain project name, so a
// fresh checkout builds and runs. A `production` bundle is headed for a store,
// where that fallback would put one name under the icon and another in the
// header, so it refuses instead — as `app.config.js` refuses the binary.

/**
 * The listing name this bundle carries, or "" for the project-name fallback.
 * @param {string | undefined} value `APP_DISPLAY_NAME`, however it was found
 * @param {string} profile the EAS profile the bundle is built for
 * @returns {string}
 */
export function listingName(value, profile) {
  const name = value?.trim() ?? "";
  if (!name && profile === "production") {
    throw new Error(
      "APP_DISPLAY_NAME is not set. A production bundle carries the listing " +
        "name in its header — set it in native/.env, or as the repository " +
        "secret the Native build workflow forwards. See RELEASING.md.",
    );
  }
  return name;
}

/**
 * Whether a built `index.html` is titled with `name` — what tells a bundle
 * built for this listing from a `native/web/` built some other way and
 * re-zipped with `--skip-build`. The `<title>` is where the `inject-app-name`
 * plugin in `vite.config.ts` substitutes `%APP_NAME%`, verbatim.
 * @param {string} html
 * @param {string} name
 * @returns {boolean}
 */
export function titledWith(html, name) {
  return html.includes(`<title>${name}</title>`);
}
