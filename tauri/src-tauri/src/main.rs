// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// An app is started from an icon, so a Windows build must not also open a
// console window behind it. Debug builds keep one, because that is where the
// developer is reading the log.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! The Notes desktop shell — a window showing the bundled site, and nothing
//! else.
//!
//! **The page never learns it is inside this app.** No initialization script,
//! no injected globals, no commands: the website is served from a private
//! scheme and runs exactly as it does in a browser tab, which is why running
//! here needed no change to the app at all. Everything Notes does — the
//! document, the settings, the sync engine — it does through the ordinary
//! browser APIs it already uses.
//!
//! Everything security-shaped is deliberate and none of it is Tauri's default:
//! the page gets no Tauri API (`withGlobalTauri` off), an almost-empty
//! permission list (`capabilities/default.json`), no commands to reach the
//! shell by, and a window pinned to our own origin (`window::navigation_guard`).

mod protocol;
mod window;

use notes_shell::config::APP_SCHEME;
use notes_shell::webroot::webroot_exists;
use tauri::{Manager, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

fn main() {
    tauri::Builder::default()
        // A SECOND COPY would fight the first over the same IndexedDB
        // document. A browser gets this for free — one origin, one storage —
        // and a desktop app has to ask for it. The second launch raises the
        // first window rather than dying silently, which is what a user who
        // double-clicked the icon twice is asking for.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // THE WHOLE APP, served off local disk from one stable origin. See
        // `notes_shell::webroot` for the three properties this arrangement is
        // for and how each is kept.
        .register_uri_scheme_protocol(APP_SCHEME, |ctx, request| {
            let root = protocol::webroot_dir(ctx.app_handle());
            protocol::serve(&request, &root)
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let root = protocol::webroot_dir(&handle);

            // A packaged app has no console, so the one failure that leaves a
            // blank window has to say so somewhere a user will see it. In a
            // checkout this is "you have not run `npm run bundle` yet".
            if notes_shell::config::remote_app_url().is_none() && !webroot_exists(&root) {
                let message = format!(
                    "Notes could not find the app it is meant to show.\n\n\
                     Looked in: {}\n\n\
                     From a checkout, build it with `npm run bundle` in tauri/.",
                    root.display()
                );
                handle
                    .dialog()
                    .message(message)
                    .kind(MessageDialogKind::Error)
                    .title("Notes")
                    .blocking_show();
                handle.exit(1);
                return Ok(());
            }

            window::build(&handle)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window ends the app. Without this the process
            // survives on macOS with no window and no menu bar to bring one
            // back — this shell has no tray, no background work and no second
            // window, so there is nothing for it to survive for.
            if matches!(event, WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("the Notes desktop shell could not start");
}
