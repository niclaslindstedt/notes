// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//! Answering the `notes://` scheme — the effects half of
//! `notes_shell::webroot`, which owns every decision this file acts on.
//!
//! Where the bundled site lives depends on the shape the app is in, and there
//! are exactly two:
//!
//! | Shape                    | `webroot/` is                      |
//! | ------------------------ | ---------------------------------- |
//! | a checkout (`cargo run`) | `tauri/webroot/`, beside the crate |
//! | a packaged app           | in the bundle's resource directory  |
//!
//! `NOTES_WEBROOT` overrides both, which is what lets a build serve a site from
//! somewhere else without recompiling — the same escape hatch `NOTES_APP_URL`
//! gives for a REMOTE site.

use std::fs;
use std::path::PathBuf;

use notes_shell::webroot::{content_type_for, resolve_webroot_file};
use tauri::http::{Request, Response};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

/// Where the bundled site is, for this shape of app.
pub fn webroot_dir(app: &AppHandle) -> PathBuf {
    if let Some(override_dir) = std::env::var_os("NOTES_WEBROOT") {
        return PathBuf::from(override_dir);
    }
    // The packaged answer first, because a developer running a packaged build
    // has both trees on disk and only one of them is the one they installed.
    if let Ok(resource) = app.path().resolve("webroot", BaseDirectory::Resource) {
        if resource.join("index.html").is_file() {
            return resource;
        }
    }
    // A checkout: `src-tauri/` is one hop below the tree `bundle-web.mjs`
    // writes into, and `CARGO_MANIFEST_DIR` is resolved at compile time — which
    // is exactly right, since this branch only ever runs from that build.
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|tree| tree.join("webroot"))
        .unwrap_or_else(|| PathBuf::from("webroot"))
}

fn not_found(path: &str) -> Response<Vec<u8>> {
    eprintln!("webroot: 404 {path}");
    Response::builder()
        .status(404)
        .header("content-type", "text/plain; charset=utf-8")
        .body(b"Not found".to_vec())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// Serve one request off the bundled site.
///
/// **Read whole rather than streamed**: Tauri's synchronous protocol handler
/// returns a body, not a stream, and the largest thing a Notes build contains
/// is a font. If an asset ever makes that wrong, the asynchronous handler is
/// the seam to move to.
pub fn serve(request: &Request<Vec<u8>>, root: &std::path::Path) -> Response<Vec<u8>> {
    let path = request.uri().path();
    let Some(file) = resolve_webroot_file(path, root) else {
        return not_found(path);
    };
    let Ok(body) = fs::read(&file) else {
        return not_found(path);
    };
    Response::builder()
        .status(200)
        .header("content-type", content_type_for(&file))
        // The bundle is on local disk and is replaced wholesale by an update,
        // so revalidation buys nothing — while a stale cached index.html
        // pointing at hashed chunks from a previous build is a silent blank
        // window.
        .header("cache-control", "no-store")
        .body(body)
        .unwrap_or_else(|_| not_found(path))
}
