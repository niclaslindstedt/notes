// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//! What one request off the bundled site resolves to — the half of this shell
//! that has anything to get wrong.
//!
//! Every case here runs against a REAL directory in the system temp, because
//! the containment check the module is for is a filesystem question:
//! `canonicalize` is what catches the symlink a lexical pass cannot, so a test
//! over strings alone would pass while the property was broken.

use std::fs;
use std::path::{Path, PathBuf};

use notes_shell::webroot::{
    content_type_for, percent_decode, resolve_webroot_file, webroot_exists,
};

/// A throwaway webroot with the shape a built site has: an entry page, a
/// hashed module under `assets/`, and a nested index.
struct Site {
    root: PathBuf,
}

impl Site {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("notes-webroot-{name}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("assets")).expect("temp webroot");
        fs::create_dir_all(root.join("privacy")).expect("temp webroot");
        fs::write(root.join("index.html"), b"<!doctype html>").expect("index");
        fs::write(root.join("assets/main-a1b2c3.js"), b"export {};").expect("module");
        fs::write(root.join("privacy/index.html"), b"<!doctype html>").expect("nested");
        Self { root }
    }

    fn path(&self) -> &Path {
        &self.root
    }
}

impl Drop for Site {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn the_bare_root_is_the_entry_page() {
    let site = Site::new("root");
    let resolved = resolve_webroot_file("/", site.path()).expect("index.html");
    assert!(resolved.ends_with("index.html"));
}

#[test]
fn a_directory_is_its_own_index() {
    let site = Site::new("directory");
    let resolved = resolve_webroot_file("/privacy/", site.path()).expect("nested index");
    assert!(resolved.ends_with("index.html"));
    assert!(resolved
        .parent()
        .is_some_and(|dir| dir.ends_with("privacy")));
}

#[test]
fn a_hashed_module_resolves_to_itself() {
    let site = Site::new("module");
    let resolved = resolve_webroot_file("/assets/main-a1b2c3.js", site.path()).expect("the module");
    assert!(resolved.ends_with("main-a1b2c3.js"));
}

#[test]
fn a_file_that_is_not_there_is_not_invented() {
    let site = Site::new("missing");
    assert!(resolve_webroot_file("/assets/gone.js", site.path()).is_none());
}

/// The whole point of the module. Both spellings of a climb out are refused,
/// including the one that has not been spelled as a `..` yet.
#[test]
fn a_path_may_not_climb_out_of_the_webroot() {
    let site = Site::new("escape");
    for probe in [
        "/../secrets.txt",
        "/assets/../../secrets.txt",
        "/%2e%2e/secrets.txt",
        "/%2E%2E%2Fsecrets.txt",
        "/./../../etc/passwd",
    ] {
        assert!(
            resolve_webroot_file(probe, site.path()).is_none(),
            "{probe} escaped the webroot"
        );
    }
}

/// An absolute path and a Windows drive prefix are refused rather than joined,
/// which is the other way a URL path reaches outside a root.
#[test]
fn an_absolute_path_is_not_a_second_root() {
    let site = Site::new("absolute");
    assert!(resolve_webroot_file("//etc/passwd", site.path()).is_none());
    assert!(resolve_webroot_file("/C:/Windows/win.ini", site.path()).is_none());
}

/// A NUL truncates a path in some syscalls, so a path carrying one is refused
/// before anything is joined with it.
#[test]
fn an_embedded_nul_is_refused() {
    let site = Site::new("nul");
    assert!(resolve_webroot_file("/index.html%00.png", site.path()).is_none());
}

/// A symlink INSIDE the webroot pointing out of it passes the lexical pass and
/// has to be caught by the canonicalized prefix check — the reason property 3
/// is done twice.
#[cfg(unix)]
#[test]
fn a_symlink_out_of_the_webroot_is_refused() {
    let site = Site::new("symlink");
    let outside = std::env::temp_dir().join("notes-webroot-symlink-outside.txt");
    fs::write(&outside, b"not the site").expect("outside file");
    std::os::unix::fs::symlink(&outside, site.path().join("escape.txt")).expect("symlink");

    assert!(resolve_webroot_file("/escape.txt", site.path()).is_none());
    let _ = fs::remove_file(&outside);
}

/// Modules are the case that breaks silently: a browser refuses a module served
/// as anything but a JavaScript type, and shows a blank page rather than an
/// error.
#[test]
fn every_type_the_built_site_contains_is_mapped() {
    for (file, expected) in [
        ("index.html", "text/html; charset=utf-8"),
        ("assets/main-a1b2c3.js", "text/javascript; charset=utf-8"),
        ("sw.mjs", "text/javascript; charset=utf-8"),
        ("assets/index.css", "text/css; charset=utf-8"),
        ("version.json", "application/json; charset=utf-8"),
        (
            "manifest.webmanifest",
            "application/manifest+json; charset=utf-8",
        ),
        ("icons/icon.svg", "image/svg+xml"),
        ("icons/pwa-512.png", "image/png"),
        ("favicon.ico", "image/x-icon"),
        ("fonts/inter.woff2", "font/woff2"),
    ] {
        assert_eq!(content_type_for(Path::new(file)), expected, "{file}");
    }
}

/// An extension nobody listed is a byte stream rather than a guess, and so is a
/// file with no extension at all.
#[test]
fn an_unknown_extension_is_not_guessed_at() {
    assert_eq!(
        content_type_for(Path::new("export.xyz")),
        "application/octet-stream"
    );
    assert_eq!(
        content_type_for(Path::new("LICENSE")),
        "application/octet-stream"
    );
}

/// The extension is matched case-insensitively — a `.PNG` off a hand-written
/// link is still an image.
#[test]
fn the_extension_is_matched_case_insensitively() {
    assert_eq!(content_type_for(Path::new("og.PNG")), "image/png");
}

#[test]
fn percent_decoding_refuses_a_truncated_escape() {
    assert_eq!(percent_decode("/a%20b.png").as_deref(), Some("/a b.png"));
    assert!(percent_decode("/a%2").is_none());
    assert!(percent_decode("/a%zz").is_none());
}

/// A checkout that has not bundled the site yet is worth a clear message rather
/// than a blank window, so it is a question this crate can answer.
#[test]
fn an_unbundled_webroot_says_so() {
    let site = Site::new("exists");
    assert!(webroot_exists(site.path()));
    assert!(!webroot_exists(&site.path().join("assets")));
}
