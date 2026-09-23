// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//! The window state is read from a file the user can open in a text editor,
//! so every case here is "what if it says something we did not write" — plus
//! the one that is not about the file at all: the monitor that got unplugged.

use std::fs;
use std::path::PathBuf;

use notes_shell::window_state::{
    load_window_state, on_some_display, save_window_state, state_file, DisplayArea, WindowState,
    DEFAULT_STATE, MIN_HEIGHT, MIN_WIDTH,
};

const LAPTOP: DisplayArea = DisplayArea {
    x: 0.0,
    y: 0.0,
    width: 1920.0,
    height: 1080.0,
};

/// A second monitor to the LEFT, which is where the negative coordinates a
/// multi-head desktop stores come from.
const SECOND: DisplayArea = DisplayArea {
    x: -2560.0,
    y: 0.0,
    width: 2560.0,
    height: 1440.0,
};

struct Dir(PathBuf);

impl Dir {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!("notes-window-{name}"));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("fixture dir");
        Self(path)
    }

    fn write(&self, json: &str) {
        fs::write(state_file(&self.0), json).expect("state file");
    }

    fn load(&self, areas: &[DisplayArea]) -> WindowState {
        load_window_state(&self.0, areas, &mut |_| {})
    }
}

impl Drop for Dir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn a_first_launch_gets_the_shipped_default() {
    let dir = Dir::new("first-launch");
    assert_eq!(dir.load(&[LAPTOP]), DEFAULT_STATE);
}

#[test]
fn a_remembered_rect_comes_back() {
    let dir = Dir::new("remembered");
    dir.write(r#"{"x":100,"y":80,"width":1600,"height":900,"maximized":false,"fullscreen":false}"#);
    let state = dir.load(&[LAPTOP]);
    assert_eq!(state.x, Some(100.0));
    assert_eq!(state.y, Some(80.0));
    assert_eq!(state.width, 1600.0);
    assert_eq!(state.height, 900.0);
}

#[test]
fn a_rect_on_a_monitor_that_is_gone_loses_its_position_but_keeps_its_size() {
    // Unplugging the second monitor must not leave the app opening somewhere
    // the user cannot reach — but the size they chose is still their choice.
    let dir = Dir::new("unplugged");
    dir.write(
        r#"{"x":-2000,"y":40,"width":1600,"height":900,"maximized":false,"fullscreen":true}"#,
    );
    let state = dir.load(&[LAPTOP]);
    assert_eq!(state.x, None);
    assert_eq!(state.y, None);
    assert_eq!(state.width, 1600.0);
    assert!(state.fullscreen);

    // With the monitor plugged back in, the same file restores completely.
    let state = dir.load(&[LAPTOP, SECOND]);
    assert_eq!(state.x, Some(-2000.0));
}

#[test]
fn a_window_hung_off_the_edge_is_kept() {
    // Overlap, not containment: a window the user deliberately pushed half
    // off the screen should come back where they left it.
    assert!(on_some_display(1850.0, 900.0, 1280.0, 720.0, &[LAPTOP]));
    assert!(!on_some_display(4000.0, 900.0, 1280.0, 720.0, &[LAPTOP]));
}

#[test]
fn no_monitors_at_all_says_nothing_rather_than_nowhere() {
    // A shell that could not enumerate displays must not be the reason a
    // user's window jumps back to the middle of the screen every launch.
    assert!(on_some_display(100.0, 100.0, 1280.0, 720.0, &[]));
}

#[test]
fn an_unreadable_file_falls_back_and_says_so() {
    let dir = Dir::new("unreadable");
    dir.write("{ this is not json");
    let mut complaints: Vec<String> = Vec::new();
    let state = load_window_state(&dir.0, &[LAPTOP], &mut |line| {
        complaints.push(line.to_string());
    });
    assert_eq!(state, DEFAULT_STATE);
    assert_eq!(
        complaints.len(),
        1,
        "one complaint, not none and not a flood"
    );
}

#[test]
fn hand_edited_nonsense_is_replaced_field_by_field() {
    let dir = Dir::new("hand-edited");
    dir.write(r#"{"x":"left","y":null,"width":-5,"height":0,"maximized":"yes"}"#);
    let state = dir.load(&[LAPTOP]);
    assert_eq!(state.width, DEFAULT_STATE.width);
    assert_eq!(state.height, DEFAULT_STATE.height);
    assert_eq!(state.x, None);
    assert!(!state.maximized, "only a real boolean turns this on");
}

#[test]
fn a_window_smaller_than_the_floor_is_grown_to_it() {
    let dir = Dir::new("too-small");
    dir.write(r#"{"width":200,"height":100,"maximized":false,"fullscreen":false}"#);
    let state = dir.load(&[LAPTOP]);
    assert_eq!(state.width, MIN_WIDTH);
    assert_eq!(state.height, MIN_HEIGHT);
}

#[test]
fn what_is_saved_is_what_is_loaded() {
    let dir = Dir::new("round-trip");
    let saved = WindowState {
        x: Some(12.0),
        y: Some(34.0),
        width: 1440.0,
        height: 810.0,
        maximized: true,
        fullscreen: false,
    };
    save_window_state(&dir.0, &saved, &mut |line| panic!("unexpected: {line}"));
    assert_eq!(dir.load(&[LAPTOP]), saved);
}

#[test]
fn a_save_that_cannot_be_written_complains_rather_than_failing_the_close() {
    // An app must not fail to close because it could not write a convenience
    // file — a directory where a file already sits is the cheapest way to make
    // the write fail on every platform.
    let dir = Dir::new("unwritable");
    let blocked = dir.0.join("blocked");
    fs::write(&blocked, "a file, not a directory").expect("blocker");
    let mut complaints: Vec<String> = Vec::new();
    save_window_state(&blocked, &DEFAULT_STATE, &mut |line| {
        complaints.push(line.to_string());
    });
    assert_eq!(complaints.len(), 1);
    assert!(complaints[0].contains("window-state"));
}
