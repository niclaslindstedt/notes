//! CLI parsing and the resolved runtime configuration.
//!
//! `notesd <folder>` points the daemon at one folder for one user. Everything
//! else is an optional override; the defaults are chosen so a bare
//! `notesd ~/my-notes` "just works": generate a key, open a port via UPnP, and
//! print a QR to pair.

use std::path::PathBuf;

use clap::Parser;

/// A self-hosted, security-first daemon backend for the notes app.
///
/// Serves ONE folder for ONE user over TLS. To host a second user, start a
/// second `notesd` pointed at a second folder.
#[derive(Debug, Parser)]
#[command(name = "notesd", version, about, long_about = None)]
pub struct Cli {
    /// The folder to serve. Stores notes as opaque bytes — it neither knows nor
    /// cares whether the client encrypts them.
    pub folder: PathBuf,

    /// Stay in the foreground and stream logs (otherwise the daemon
    /// double-forks into the background).
    #[arg(short = 'f', long)]
    pub follow: bool,

    /// Verbose logging for diagnosing problems. Secrets are never logged at any
    /// level.
    #[arg(long)]
    pub debug: bool,

    /// Force a specific TCP port (e.g. when UPnP is unavailable). Without this
    /// an ephemeral port is chosen.
    #[arg(long)]
    pub port: Option<u16>,

    /// Use a specific static API key instead of the per-device pairing flow.
    /// Must be strong (>= 32 chars); a weak value is rejected. Intended for
    /// CI / simple single-key setups.
    #[arg(long)]
    pub api_key: Option<String>,

    /// Disable UPnP and run LAN-only (discoverable via mDNS). The default is to
    /// map an external port via UPnP — which exposes this machine to the
    /// internet.
    #[arg(long)]
    pub no_upnp: bool,

    /// Human label shown in the app's backend list. Defaults to the hostname.
    #[arg(long)]
    pub name: Option<String>,
}

impl Cli {
    /// The display name for this daemon, falling back to the machine hostname.
    pub fn display_name(&self) -> String {
        self.name
            .clone()
            .unwrap_or_else(|| hostname_string().unwrap_or_else(|| "notesd".to_string()))
    }
}

/// Best-effort hostname without pulling in a crate: read the kernel's value.
fn hostname_string() -> Option<String> {
    std::fs::read_to_string("/proc/sys/kernel/hostname")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("HOSTNAME").ok().filter(|s| !s.is_empty()))
}

/// The minimum length we accept for a user-supplied `--api-key`. A generated
/// key is 256 bits of base32 (52 chars); a hand-picked key must clear a floor
/// so a weak password can't become a network credential.
pub const MIN_API_KEY_LEN: usize = 32;
