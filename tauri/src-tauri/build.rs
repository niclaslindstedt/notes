// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//! Tauri's own build step, and nothing beside it.
//!
//! It reads `tauri.conf.json`, generates the permission schemas
//! `capabilities/default.json` is checked against, and on Windows compiles the
//! resource block carrying the icon and the version. A wrapper this thin has
//! nothing else to do here — which is the point.

fn main() {
    tauri_build::build();
}
