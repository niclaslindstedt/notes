// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//! Remembering the window's size, position and maximized/fullscreen state
//! between launches.
//!
//! A browser tab has no such memory and needs none — the browser owns the
//! window. A desktop app that reopens at its default size in the middle of the
//! screen every launch, after the user has sized it to their monitor, reads as
//! a web page in a frame rather than as an app they installed. This is the
//! cheapest thing that fixes that.
//!
//! It deliberately does NOT go through the app's own settings: window
//! geometry is device-shaped state, and a web page cannot size or place its
//! own OS window anyway. So it lives here, in the shell, in the OS's per-user
//! app directory, and never leaves the machine — the page never learns of it.
//!
//! Every read is defensive: the file is user-writable and survives across
//! updates, so it is treated as untrusted input rather than as something we
//! wrote. A rect that no longer lands on any attached display is discarded
//! rather than restored — otherwise unplugging a second monitor leaves the app
//! opening off-screen with no way to get it back.
//!
//! The module takes the attached monitors as an ARGUMENT rather than asking a
//! window manager for them, which is what keeps it in this crate: the
//! validation below is the part with the bugs in it, and code that reached for
//! Tauri's monitor list could only ever be exercised with a display attached.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::config::{DEFAULT_HEIGHT, DEFAULT_WIDTH};

/// One monitor's usable area, passed in by the caller so this module needs no
/// windowing system.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DisplayArea {
    /// Left edge, in the desktop's virtual coordinate space.
    pub x: f64,
    /// Top edge, in the desktop's virtual coordinate space.
    pub y: f64,
    /// Usable width.
    pub width: f64,
    /// Usable height.
    pub height: f64,
}

/// The remembered geometry. The position is optional — a first launch has none,
/// and lets the window manager place the window.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WindowState {
    /// Left edge, when one was remembered and still lands on a monitor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    /// Top edge, when one was remembered and still lands on a monitor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    /// Window width.
    pub width: f64,
    /// Window height.
    pub height: f64,
    /// Whether the window was maximized when it was last closed.
    pub maximized: bool,
    /// Whether the window was fullscreen when it was last closed.
    pub fullscreen: bool,
}

/// The shipped default: the window's opening size from `config`, placed by the
/// window manager.
pub const DEFAULT_STATE: WindowState = WindowState {
    x: None,
    y: None,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    maximized: false,
    fullscreen: false,
};

/// The floor the window may be dragged to — the same one `config` gives the
/// window builder, re-exported so a stored size is held to it too.
pub use crate::config::{MIN_HEIGHT, MIN_WIDTH};

/// Where the remembered geometry is kept, inside the app's user-data directory.
pub fn state_file(user_data_dir: &Path) -> PathBuf {
    user_data_dir.join("window-state.json")
}

/// What a stored state file may say, before any of it has been believed.
///
/// Every field is optional and every one is `f64`, because this is a file a
/// user can open in a text editor: a missing field, a string where a number
/// belongs, or a hand-typed `-1` are all things that reach this struct, and
/// [`load_window_state`] is where each of them is answered.
#[derive(Debug, Default, Deserialize)]
struct StoredState {
    x: Option<f64>,
    y: Option<f64>,
    width: Option<f64>,
    height: Option<f64>,
    maximized: Option<bool>,
    fullscreen: Option<bool>,
}

/// A stored dimension, or `None` when it is not one: finite, above zero, and
/// rounded, since a fractional window size is a stored artifact of a scaled
/// display rather than anything the user chose.
fn positive(value: Option<f64>) -> Option<f64> {
    value
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(f64::round)
}

/// Read the remembered state, falling back to the default on anything at all
/// wrong with it — missing, unparseable, hand-edited, or describing a rect that
/// no longer fits any attached monitor.
///
/// `warn` is where a complaint goes, handed in rather than reached for so this
/// module keeps no opinion about where diagnostics live.
pub fn load_window_state(
    user_data_dir: &Path,
    areas: &[DisplayArea],
    warn: &mut dyn FnMut(&str),
) -> WindowState {
    let file = state_file(user_data_dir);
    if !file.is_file() {
        return DEFAULT_STATE;
    }
    let stored = fs::read_to_string(&file)
        .ok()
        .and_then(|text| serde_json::from_str::<StoredState>(&text).ok());
    let Some(stored) = stored else {
        warn("window-state: unreadable, falling back to the default size");
        return DEFAULT_STATE;
    };

    let mut state = WindowState {
        x: None,
        y: None,
        width: positive(stored.width)
            .unwrap_or(DEFAULT_STATE.width)
            .max(MIN_WIDTH),
        height: positive(stored.height)
            .unwrap_or(DEFAULT_STATE.height)
            .max(MIN_HEIGHT),
        maximized: stored.maximized.unwrap_or(false),
        fullscreen: stored.fullscreen.unwrap_or(false),
    };

    // Only keep a position that still lands on a monitor — see the header.
    if let (Some(x), Some(y)) = (stored.x, stored.y) {
        if x.is_finite() && y.is_finite() && on_some_display(x, y, state.width, state.height, areas)
        {
            state.x = Some(x.round());
            state.y = Some(y.round());
        }
    }
    state
}

/// Persist the state. Never fails outward — an app must not fail to close
/// because it could not write a convenience file.
pub fn save_window_state(user_data_dir: &Path, state: &WindowState, warn: &mut dyn FnMut(&str)) {
    let file = state_file(user_data_dir);
    let written = fs::create_dir_all(user_data_dir).and_then(|()| {
        let json = serde_json::to_string_pretty(state)?;
        fs::write(&file, json)
    });
    if let Err(err) = written {
        warn(&format!("window-state: could not save — {err}"));
    }
}

/// Does this rect overlap the working area of any attached monitor?
///
/// Overlap, not containment: a window the user deliberately hung off the edge
/// of their screen should come back where they left it. What this rejects is a
/// rect with NO intersection anywhere — the unplugged-monitor case, where
/// restoring faithfully means opening somewhere the user cannot reach.
///
/// An EMPTY monitor list says nothing rather than "nowhere", so the position is
/// kept: a shell that could not enumerate displays must not be the reason a
/// user's window jumps back to the middle of a screen every launch.
pub fn on_some_display(x: f64, y: f64, width: f64, height: f64, areas: &[DisplayArea]) -> bool {
    if areas.is_empty() {
        return true;
    }
    areas.iter().any(|area| {
        x < area.x + area.width
            && x + width > area.x
            && y < area.y + area.height
            && y + height > area.y
    })
}
