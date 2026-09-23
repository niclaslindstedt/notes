// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//! THE WINDOW — building it, and keeping it pinned to our own origin.
//!
//! The one thing kept between launches is where the window was: its size,
//! position and maximized / fullscreen state, in the app's own data directory.
//! Every decision about that file is `notes_shell::window_state`'s; this
//! file only asks the window and the monitors.

use notes_shell::config::{
    app_origin, is_internal_url, remote_app_url, start_url, BRAND_BG, WINDOW_TITLE,
};
use notes_shell::window_state::{
    load_window_state, save_window_state, DisplayArea, WindowState, MIN_HEIGHT, MIN_WIDTH,
};
use std::path::{Path, PathBuf};
use tauri::webview::NewWindowResponse;

use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
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

    // Where the remembered geometry lives. Without a data directory there is
    // nothing to remember into, and the window opens at its default size.
    let user_data = app.path().app_data_dir().ok();
    let state = user_data
        .as_deref()
        .map(|dir| load_window_state(dir, &[], &mut warn))
        .unwrap_or(DEFAULT_WINDOW);

    let (r, g, b, a) = BRAND_BG;
    let window = WebviewWindowBuilder::new(app, "main", url)
        .title(WINDOW_TITLE)
        .inner_size(state.width, state.height)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        // Hidden until it is where it belongs, so it never opens in one place
        // and jumps to another.
        .visible(false)
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

    // NOW the monitors can be asked, so the remembered POSITION gets its
    // does-this-still-land-anywhere check.
    if let Some(dir) = user_data.as_deref() {
        let placed = load_window_state(dir, &display_areas(&window), &mut warn);
        if let (Some(x), Some(y)) = (placed.x, placed.y) {
            let _ = window.set_position(LogicalPosition::new(x, y));
        }
        if placed.maximized {
            let _ = window.maximize();
        }
        if placed.fullscreen {
            let _ = window.set_fullscreen(true);
        }
    }
    let _ = window.show();

    if let Some(dir) = user_data {
        remember_on_close(&window, dir);
    }
    Ok(window)
}

/// The shipped geometry, for a build with no data directory to read one from.
const DEFAULT_WINDOW: WindowState = notes_shell::window_state::DEFAULT_STATE;

fn warn(line: &str) {
    eprintln!("{line}");
}

/// The monitors' areas, in the logical pixels the stored rect is in. Tauri
/// reports PHYSICAL pixels with a scale factor per monitor, so the conversion
/// happens per monitor — a laptop with an external display routinely has two.
fn display_areas(window: &WebviewWindow) -> Vec<DisplayArea> {
    let Ok(monitors) = window.available_monitors() else {
        // Says nothing rather than "nowhere": an empty list keeps the
        // remembered position (see `window_state::on_some_display`).
        return Vec::new();
    };
    monitors
        .iter()
        .map(|monitor| {
            let scale = monitor.scale_factor();
            let position = monitor.position().to_logical::<f64>(scale);
            let size = monitor.size().to_logical::<f64>(scale);
            DisplayArea {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            }
        })
        .collect()
}

/// Write the geometry down on the CLOSE REQUEST — the last moment the window
/// still exists to be asked.
fn remember_on_close(window: &WebviewWindow, user_data: PathBuf) {
    let handle = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { .. } = event {
            remember_now(&handle, &user_data);
        }
    });
}

/// Where the window is, right now. The rect is read UN-MAXIMIZED: a maximized
/// or fullscreen window reports the screen, and restoring that as its normal
/// size would leave the user unable to get a small window back — so those keep
/// the stored rect and change only the flag.
fn remember_now(window: &WebviewWindow, user_data: &Path) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let maximized = window.is_maximized().unwrap_or(false);
    let fullscreen = window.is_fullscreen().unwrap_or(false);
    let size = window
        .inner_size()
        .map(|size| size.to_logical::<f64>(scale))
        .unwrap_or(LogicalSize::new(0.0, 0.0));
    let position = window
        .outer_position()
        .map(|position| position.to_logical::<f64>(scale))
        .ok();

    let stored = load_window_state(user_data, &[], &mut |_| {});
    let (width, height, x, y) = if maximized || fullscreen {
        (stored.width, stored.height, stored.x, stored.y)
    } else {
        (
            size.width.max(MIN_WIDTH),
            size.height.max(MIN_HEIGHT),
            position.map(|p| p.x),
            position.map(|p| p.y),
        )
    };
    save_window_state(
        user_data,
        &WindowState {
            x,
            y,
            width,
            height,
            maximized,
            fullscreen,
        },
        &mut warn,
    );
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
