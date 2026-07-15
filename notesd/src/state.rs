//! Durable daemon state, kept **outside** the notes folder so the folder stays
//! dumb. Everything here is device/operator state, not note data:
//!
//! - the self-signed cert + key (`cert.pem` / `key.pem`, see [`crate::tls`]),
//! - the hashed device-key roster (`roster.json`),
//! - the persisted aggregate revision counter (`rev`).
//!
//! The state dir is keyed by the served folder's canonical path, so two
//! daemons over two folders never share a cert, a roster, or a revision line.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::secret::{ct_eq, sha256_hex};

/// One paired device's credential. We store only the SHA-256 of the key, never
/// the key itself — a stolen roster can't be replayed as a credential.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceKey {
    pub id: String,
    pub label: String,
    /// Hex SHA-256 of the bearer key.
    pub key_hash: String,
    /// Seconds since the Unix epoch, best-effort, for the "paired on" display.
    pub created_at: u64,
}

/// The device roster plus an optional static key (from `--api-key`). Persisted
/// as `roster.json` in the state dir.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Roster {
    #[serde(default)]
    pub devices: Vec<DeviceKey>,
    /// Hex SHA-256 of a `--api-key` static key, if one is configured. Kept
    /// separate from `devices` so it survives roster edits and can't be
    /// revoked by device management.
    #[serde(default)]
    pub static_key_hash: Option<String>,
}

impl Roster {
    /// True if `presented` matches the static key or any device key. The scan is
    /// constant-time per candidate; a non-match still walks every entry so
    /// timing doesn't leak which slot (if any) was close.
    pub fn accepts(&self, presented: &str) -> bool {
        let candidate = sha256_hex(presented.as_bytes());
        let cbytes = candidate.as_bytes();
        let mut ok = false;
        if let Some(h) = &self.static_key_hash {
            ok |= ct_eq(h.as_bytes(), cbytes);
        }
        for d in &self.devices {
            ok |= ct_eq(d.key_hash.as_bytes(), cbytes);
        }
        ok
    }

    /// Register a freshly minted device key (called from the pairing flow).
    pub fn add_device(&mut self, id: String, label: String, key: &str, created_at: u64) {
        self.devices.push(DeviceKey {
            id,
            label,
            key_hash: sha256_hex(key.as_bytes()),
            created_at,
        });
    }

    /// Remove a device by id. Returns whether anything was removed.
    pub fn revoke(&mut self, id: &str) -> bool {
        let before = self.devices.len();
        self.devices.retain(|d| d.id != id);
        self.devices.len() != before
    }
}

/// Handle to the on-disk state directory.
pub struct StateDir {
    pub dir: PathBuf,
}

impl StateDir {
    /// Resolve (and create) the state dir for `folder`. Layout:
    /// `$XDG_STATE_HOME/notesd/<hash-of-folder-path>/` (falling back to
    /// `~/.local/state`). The hash keeps one daemon-per-folder isolated.
    pub fn resolve(folder: &Path) -> Result<Self> {
        let canonical = folder
            .canonicalize()
            .with_context(|| format!("resolving folder {}", folder.display()))?;
        let key = sha256_hex(canonical.to_string_lossy().as_bytes());
        let base = state_home().join("notesd").join(&key[..16]);
        std::fs::create_dir_all(&base)
            .with_context(|| format!("creating state dir {}", base.display()))?;
        harden_dir(&base)?;
        Ok(Self { dir: base })
    }

    fn roster_path(&self) -> PathBuf {
        self.dir.join("roster.json")
    }

    fn rev_path(&self) -> PathBuf {
        self.dir.join("rev")
    }

    /// Load the roster, or an empty one on first run.
    pub fn load_roster(&self) -> Result<Roster> {
        match std::fs::read_to_string(self.roster_path()) {
            Ok(text) => serde_json::from_str(&text).context("parsing roster.json"),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Roster::default()),
            Err(e) => Err(e).context("reading roster.json"),
        }
    }

    /// Persist the roster `0600`.
    pub fn save_roster(&self, roster: &Roster) -> Result<()> {
        let text = serde_json::to_string_pretty(roster)?;
        write_private(&self.roster_path(), text.as_bytes())
    }

    /// Load the persisted aggregate revision counter (0 on first run).
    pub fn load_rev(&self) -> u64 {
        std::fs::read_to_string(self.rev_path())
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0)
    }

    /// Persist the aggregate revision counter.
    pub fn save_rev(&self, rev: u64) -> Result<()> {
        write_private(&self.rev_path(), rev.to_string().as_bytes())
    }
}

fn state_home() -> PathBuf {
    if let Ok(dir) = std::env::var("XDG_STATE_HOME") {
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".local").join("state")
}

/// Tighten the state dir to `0700` on Unix — nothing but the owner reads keys.
fn harden_dir(dir: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
            .with_context(|| format!("chmod 700 {}", dir.display()))?;
    }
    #[cfg(not(unix))]
    let _ = dir;
    Ok(())
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    std::fs::write(path, bytes).with_context(|| format!("writing {}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .with_context(|| format!("chmod 600 {}", path.display()))?;
    }
    Ok(())
}

/// Seconds since the Unix epoch, saturating at 0 if the clock is before it.
pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
