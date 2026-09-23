// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//! THE WINDOW — building it, and keeping it pinned to our own origin.
//!
//! There is no geometry to remember here and no state to persist: Tauri
//! remembers nothing by itself, and a wrapper this thin does not add a store
//! for it. The window opens at a sensible size, the app inside it is the app,
//! and that is the whole of this file bar the navigation guard.

use notes_shell::config::{
    app_origin, is_internal_url, remote_app_url, start_url, BRAND_BG, DEFAULT_HEIGHT,
    DEFAULT_WIDTH, MIN_HEIGHT, MIN_WIDTH, WINDOW_TITLE,
};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

/// The origin the platform grants our registered scheme, for this build.
pub fn origin() -> String {
    app_origin(cfg!(windows))
}

/// Build the app's window and point it at the app.
pub fn build(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let remote = remote_app_url();
    let origin = origin();
    let target = remote.clone().unwrap_or_else(|| start_url(&origin));

    println!("loading {target}");
    let url = target
        .parse::<Url>()
        .map_err(|_| tauri::Error::UnknownPath)
        .map(WebviewUrl::External)?;

    let (r, g, b, a) = BRAND_BG;
    let window = WebviewWindowBuilder::new(app, "main", url)
        .title(WINDOW_TITLE)
        .inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        // The app's own dark surface, so the window is never a white rectangle
        // that fills in — the desktop equivalent of the theme-color meta tag
        // the site already carries.
        .background_color(tauri::window::Color(r, g, b, a))
        .on_navigation(navigation_guard(app.clone(), origin, remote))
        // `window.open` is how the page starts a sign-in: the provider's
        // consent screen, in the user's own browser. This window never grows
        // a second one — an http(s) URL goes to the browser, anything else is
        // refused, and the page gets no window handle either way.
        .on_new_window({
            let app = app.clone();
            move |url, _features| {
                open_in_browser(&app, url.as_str());
                NewWindowResponse::Deny
            }
        })
        .build()?;

    Ok(window)
}

/// Keep the window on our own origin, and send everything else to the browser.
///
/// The app's own pages navigate normally. An external link — the repository,
/// the licence, a credit — would otherwise REPLACE the app with a web page
/// that has no back button, since this window has no chrome of its own. So it
/// is handed to the user's browser and the navigation is refused.
fn navigation_guard(
    app: AppHandle,
    origin: String,
    remote: Option<String>,
) -> impl Fn(&Url) -> bool + Send + Sync + 'static {
    move |url: &Url| {
        let url = url.as_str();
        if is_internal_url(url, &origin, remote.as_deref()) {
            return true;
        }
        open_in_browser(&app, url);
        false
    }
}

/// Hand a URL to the user's browser. `http(s)` only: a `mailto:` or a
/// `javascript:` reaching the opener is a mail client or a script this shell
/// never meant to launch.
fn open_in_browser(app: &AppHandle, url: &str) {
    if url.starts_with("http://") || url.starts_with("https://") {
        if let Err(err) = app.opener().open_url(url, None::<&str>) {
            eprintln!("could not open {url} in the browser — {err}");
        }
    } else {
        eprintln!("refused navigation to {url}");
    }
}
