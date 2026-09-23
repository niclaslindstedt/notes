// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//! Where the desktop shell points itself, and what it calls itself.
//!
//! By default the app is self-contained: it serves the website copied inside it
//! (`tauri/webroot/`, a gitignored build artifact from
//! `scripts/bundle-web.mjs`) over a private scheme, so the app runs on-device
//! and offline and changes only when a new binary ships.
//!
//! Two launch-time overrides exist and both are for developing rather than for
//! shipping: `NOTES_APP_URL` points the window at a remote URL instead (the
//! `/preview/` deploy slot, say), and `NOTES_WEBROOT` serves a different
//! directory without rebuilding the binary.

/// The private scheme the bundled site is served from.
///
/// **NOT `file://`.** The site is built with `base: "/"`, so its absolute asset
/// paths and ES-module imports need a real origin to resolve against — and a
/// `file://` page is an opaque origin, which would leave `localStorage` and
/// IndexedDB unable to keep a note between launches. A registered scheme
/// gives one stable origin that the notes are keyed to for the life of the
/// install.
pub const APP_SCHEME: &str = "notes";

/// The host the bundled site is served under.
///
/// `localhost` is a platform fact rather than a preference: WebView2 maps a
/// registered scheme onto `http://<scheme>.localhost`, so the host has to be
/// one that platform will accept in that shape. What matters is that it is a
/// CONSTANT — the origin is what the user's notes are keyed to, so changing
/// this word later orphans every document on the machine.
pub const APP_HOST: &str = "localhost";

/// The page inside the bundle that the window opens on.
pub const APP_ENTRY: &str = "index.html";

/// The app's dark plate (`THEME` in `scripts/gen-native-icons.mjs`,
/// `#0e1116` — the same ink as the favicon and the manifest's background),
/// painted behind the page so no white flash shows through while it loads.
pub const BRAND_BG: (u8, u8, u8, u8) = (0x0e, 0x11, 0x16, 0xff);

/// What the window is called.
pub const WINDOW_TITLE: &str = "Notes";

/// The window's opening size, and the smallest it may be dragged to.
///
/// The floor is the narrowest the note list and an open note are both usable
/// at — below it the app is not broken, it is just a smaller phone.
pub const DEFAULT_WIDTH: f64 = 1280.0;
pub const DEFAULT_HEIGHT: f64 = 860.0;
pub const MIN_WIDTH: f64 = 360.0;
pub const MIN_HEIGHT: f64 = 480.0;

/// A remote URL to load instead of the bundled site, or `None` to serve the
/// copy inside the app.
pub fn remote_app_url() -> Option<String> {
    std::env::var("NOTES_APP_URL")
        .ok()
        .filter(|url| !url.is_empty())
}

/// The origin the platform grants our registered scheme.
///
/// The two desktop webviews spell it differently and there is no arguing with
/// either: WebView2 maps a registered scheme onto `http://<scheme>.localhost`,
/// while WKWebView and WebKitGTK serve it as a real `<scheme>://` URL. Both are
/// ONE CONSTANT per platform, which is the property that actually matters.
pub fn app_origin(windows: bool) -> String {
    if windows {
        format!("http://{APP_SCHEME}.{APP_HOST}")
    } else {
        format!("{APP_SCHEME}://{APP_HOST}")
    }
}

/// The URL the window opens, given the origin the platform actually granted.
pub fn start_url(origin: &str) -> String {
    format!("{}/{APP_ENTRY}", origin.trim_end_matches('/'))
}

/// Is this URL somewhere the app window may navigate to itself?
///
/// The app's own pages are same-origin and navigate normally; anything else —
/// the repository link, the licence, a credit — opens in the user's browser
/// rather than replacing the app with a web page it cannot leave. That is the
/// whole of this shell's "security policy", and it is one comparison.
pub fn is_internal_url(url: &str, origin: &str, remote: Option<&str>) -> bool {
    let origin = origin.trim_end_matches('/');
    if url == origin || url.starts_with(&format!("{origin}/")) {
        return true;
    }
    remote.is_some_and(|remote| !remote.is_empty() && url.starts_with(remote))
}
