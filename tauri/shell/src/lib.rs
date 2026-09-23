// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//! The Notes desktop shell's decision layer.
//!
//! Everything here is a pure function over its arguments: no Tauri, no window,
//! no filesystem beyond asking whether a path exists. The effects that act on
//! these answers live in the `notes-tauri` crate next door.
//!
//! There are only two decisions a wrapper this thin makes, and both are here —
//! [`config`] (what the app is called and what origin it lives at) and
//! [`webroot`] (what one request off the bundled site resolves to).

pub mod config;
pub mod webroot;
