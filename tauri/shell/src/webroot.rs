// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//! Serving the bundled website — the one module in this tree that would be
//! wrong to simplify.
//!
//! The site is served from a registered private scheme (`notes://`, see
//! [`crate::config`]) handled in-process: no port to pick, no port to collide
//! with, no socket listening on the user's machine, and no window in which
//! another program could talk to it. Three properties matter and each is easy
//! to lose:
//!
//!  1. **One stable origin.** The user's notes live in IndexedDB and their
//!     settings in `localStorage`, both keyed by origin. `notes://` is a
//!     constant, so the notes survive every update. A `file://` page (or a
//!     server on an ephemeral port) would hand the user a different origin —
//!     and an empty notes — at some point.
//!
//!  2. **Correct Content-Type, from us.** The site is ES modules; a browser
//!     refuses a module served as anything but a JavaScript type, and the
//!     failure is a blank window rather than an error. So the type is mapped
//!     explicitly from the extension here rather than left to be inferred.
//!
//!  3. **No path escape.** The URL path is attacker-influenced in principle
//!     (any link the page follows), so the resolved file is checked to be
//!     INSIDE the webroot before it is read.
//!
//! **Property 3 is done twice here, and on purpose.** The path is first
//! normalized LEXICALLY — segments resolved, a `..` refused outright — and the
//! joined result is then canonicalized and checked to still start with the
//! root. Either half alone has a known hole: a lexical pass is defeated by a
//! symlink inside the webroot pointing out of it, and a prefix check on the
//! raw join is defeated by a `..` the filesystem resolves before the
//! comparison.

use std::path::{Component, Path, PathBuf};

/// The content types the built site actually contains, mapped from the
/// extension. Anything unlisted is served as a byte stream rather than guessed
/// at — a wrong guess on a module is a blank window.
const CONTENT_TYPES: &[(&str, &str)] = &[
    ("html", "text/html; charset=utf-8"),
    ("js", "text/javascript; charset=utf-8"),
    ("mjs", "text/javascript; charset=utf-8"),
    ("css", "text/css; charset=utf-8"),
    ("json", "application/json; charset=utf-8"),
    ("webmanifest", "application/manifest+json; charset=utf-8"),
    ("svg", "image/svg+xml"),
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("webp", "image/webp"),
    ("ico", "image/x-icon"),
    ("woff2", "font/woff2"),
    ("woff", "font/woff"),
    ("ttf", "font/ttf"),
    ("txt", "text/plain; charset=utf-8"),
    ("xml", "application/xml; charset=utf-8"),
    ("wasm", "application/wasm"),
    ("map", "application/json; charset=utf-8"),
];

/// The Content-Type one file is served as.
pub fn content_type_for(path: &Path) -> &'static str {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);
    let Some(extension) = extension else {
        return "application/octet-stream";
    };
    CONTENT_TYPES
        .iter()
        .find(|(name, _)| *name == extension)
        .map(|(_, kind)| *kind)
        .unwrap_or("application/octet-stream")
}

/// Percent-decode one URL path, or `None` when it is not a decodable path.
///
/// Done BEFORE the containment check rather than after, because `%2e%2e` is a
/// `..` that has not been spelled as one yet — and a decode failure is a
/// refusal rather than a fall back to the raw string, since "we could not read
/// this path" is not a reason to serve whatever it looked like.
pub fn percent_decode(path: &str) -> Option<String> {
    let raw = path.as_bytes();
    let mut out = Vec::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        match raw[i] {
            b'%' => {
                let hi = hex(*raw.get(i + 1)?)?;
                let lo = hex(*raw.get(i + 2)?)?;
                out.push(hi * 16 + lo);
                i += 3;
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

fn hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Resolve a decoded request path to a relative path that cannot leave the
/// root — the lexical half of property 3.
///
/// Every segment is walked: `.` is dropped, `..` is REFUSED rather than
/// clamped (a path with one in it is not one this site ever emits, so it is a
/// probe, and answering it with "here is the root instead" would make probing
/// free), and a Windows prefix or a root component is refused outright —
/// `notes:///C:/…` must not become a drive letter.
fn contain_lexically(decoded: &str) -> Option<PathBuf> {
    let trimmed = decoded.trim_start_matches('/');
    let mut out = PathBuf::new();
    for component in Path::new(trimmed).components() {
        match component {
            Component::Normal(segment) => out.push(segment),
            Component::CurDir => {}
            Component::ParentDir => return None,
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(out)
}

/// Resolve one request path to a file inside `root`, or `None` when it escapes
/// or does not exist.
///
/// A directory (and the bare root) resolves to its `index.html`.
pub fn resolve_webroot_file(url_path: &str, root: &Path) -> Option<PathBuf> {
    let decoded = percent_decode(url_path)?;
    // A NUL truncates a path in some syscalls — refuse outright.
    if decoded.contains('\0') {
        return None;
    }
    let relative = contain_lexically(&decoded)?;
    let candidate = root.join(relative);

    // The second half of property 3, on the REAL path: a symlink inside the
    // webroot pointing out of it passes the lexical pass and is caught here.
    // Canonicalizing also proves the file exists, which is the next question.
    let real = candidate.canonicalize().ok()?;
    let real_root = root.canonicalize().ok()?;
    if real != real_root && !real.starts_with(&real_root) {
        return None;
    }

    if real.is_dir() {
        let index = real.join("index.html");
        return index.is_file().then_some(index);
    }
    real.is_file().then_some(real)
}

/// Is the site actually bundled?
///
/// False in a fresh checkout that has not run `npm run bundle` yet — worth a
/// clear message rather than a blank window.
pub fn webroot_exists(root: &Path) -> bool {
    root.join("index.html").is_file()
}
