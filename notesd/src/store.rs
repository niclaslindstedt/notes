//! The dumb file store over the served folder.
//!
//! This is byte-compatible with the app's directory format
//! (`src/storage/directory-adapter.ts`): each note is one top-level file
//! (`<slug>-<id>.md` plaintext or `<ref>.enc` when the client encrypts), its
//! attachments live under `attachments/<note-stem>/<file>`, and the root also
//! holds `settings.json` / `namespaces.json`. The daemon never parses any of
//! it — a note is just a filename, some bytes, and an mtime. That's the whole
//! point: the folder neither knows nor cares whether the client encrypts.
//!
//! Every path that comes off the wire is validated to a single, safe path
//! component before it touches disk (no `/`, no `..`, no dotfiles), so a
//! crafted ref can never escape the folder. Writes are atomic:
//! write-temp → fsync → rename.

use std::io::Write;
use std::path::{Path, PathBuf};

use crate::secret::{b32, random_32, sha256_hex};

/// Files at the root that are settings, not notes — excluded from note listings
/// and rejected as note refs so the two namespaces never collide.
pub const RESERVED: &[&str] = &["settings.json", "namespaces.json"];

/// The subdirectory holding externalised attachments.
pub const ATTACHMENTS_DIR: &str = "attachments";

/// Settings files a client may read/write through `/v1/settings/<name>`.
pub const ALLOWED_SETTINGS: &[&str] = &["settings.json", "namespaces.json"];

/// Store errors, split so the server can map them to the right HTTP status: a
/// rejected/invalid name is the client's fault (400), an I/O failure is ours
/// (500).
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("{0}")]
    Invalid(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

type Result<T> = std::result::Result<T, StoreError>;

/// One note's listing metadata (no body).
#[derive(Debug, Clone)]
pub struct NoteMeta {
    pub reference: String,
    /// Hex SHA-256 of the file bytes — the etag.
    pub etag: String,
}

pub struct Store {
    root: PathBuf,
}

impl Store {
    pub fn open(root: &Path) -> Result<Self> {
        std::fs::create_dir_all(root)?;
        Ok(Self {
            root: root.to_path_buf(),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    // -- path safety --------------------------------------------------------

    /// Validate one wire path component: non-empty, <=255 bytes, no separators,
    /// no `..`, no leading dot, only `[A-Za-z0-9._-]`.
    fn safe_component(&self, part: &str) -> Result<String> {
        if part.is_empty() || part.len() > 255 {
            return Err(StoreError::Invalid("invalid name length".into()));
        }
        if part.starts_with('.') {
            return Err(StoreError::Invalid("dotfiles are not addressable".into()));
        }
        if part.contains("..") {
            return Err(StoreError::Invalid("path traversal rejected".into()));
        }
        if part
            .chars()
            .any(|c| !(c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')))
        {
            return Err(StoreError::Invalid("illegal character in name".into()));
        }
        Ok(part.to_string())
    }

    /// The on-disk path for a note ref, validated. Rejects reserved settings
    /// names so a note write can't clobber `settings.json`.
    fn note_path(&self, reference: &str) -> Result<PathBuf> {
        let name = self.safe_component(reference)?;
        if RESERVED.contains(&name.as_str()) {
            return Err(StoreError::Invalid("reserved name is not a note".into()));
        }
        Ok(self.root.join(name))
    }

    // -- notes --------------------------------------------------------------

    /// List every note file at the root (excluding reserved files and the
    /// attachments dir), with etag + mtime + size.
    pub fn list(&self) -> Result<Vec<NoteMeta>> {
        let mut out = Vec::new();
        let entries = match std::fs::read_dir(&self.root) {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
            Err(e) => return Err(e.into()),
        };
        for entry in entries {
            let entry = entry?;
            let meta = entry.metadata()?;
            if !meta.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || RESERVED.contains(&name.as_str()) {
                continue;
            }
            let bytes = std::fs::read(entry.path())?;
            out.push(NoteMeta {
                etag: sha256_hex(&bytes),
                reference: name,
            });
        }
        out.sort_by(|a, b| a.reference.cmp(&b.reference));
        Ok(out)
    }

    /// Read one note's raw bytes, or `None` if absent.
    pub fn read_note(&self, reference: &str) -> Result<Option<Vec<u8>>> {
        read_opt(&self.note_path(reference)?)
    }

    /// The current etag for a note, or `None` if absent.
    pub fn note_etag(&self, reference: &str) -> Result<Option<String>> {
        Ok(self.read_note(reference)?.map(|b| sha256_hex(&b)))
    }

    /// Atomically write a note's bytes; returns the new etag.
    pub fn write_note(&self, reference: &str, bytes: &[u8]) -> Result<String> {
        let path = self.note_path(reference)?;
        atomic_write(&self.root, &path, bytes)?;
        Ok(sha256_hex(bytes))
    }

    /// Delete a note (and its attachment subtree). Returns whether it existed.
    pub fn delete_note(&self, reference: &str) -> Result<bool> {
        let path = self.note_path(reference)?;
        let existed = match std::fs::remove_file(&path) {
            Ok(()) => true,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
            Err(e) => return Err(e.into()),
        };
        // Best-effort: drop the note's attachment folder too, keyed on the stem
        // (filename without its final extension), mirroring the app's
        // `<note-stem>/` attachment layout.
        if let Some(stem) = Path::new(reference).file_stem().and_then(|s| s.to_str()) {
            if let Ok(dir) = self.attachment_dir(stem) {
                let _ = std::fs::remove_dir_all(dir);
            }
        }
        Ok(existed)
    }

    // -- attachments --------------------------------------------------------

    fn attachment_dir(&self, note_stem: &str) -> Result<PathBuf> {
        let stem = self.safe_component(note_stem)?;
        Ok(self.root.join(ATTACHMENTS_DIR).join(stem))
    }

    fn attachment_path(&self, note_stem: &str, file: &str) -> Result<PathBuf> {
        let file = self.safe_component(file)?;
        Ok(self.attachment_dir(note_stem)?.join(file))
    }

    pub fn read_attachment(&self, note_stem: &str, file: &str) -> Result<Option<Vec<u8>>> {
        read_opt(&self.attachment_path(note_stem, file)?)
    }

    pub fn write_attachment(&self, note_stem: &str, file: &str, bytes: &[u8]) -> Result<()> {
        let path = self.attachment_path(note_stem, file)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        atomic_write(&self.root, &path, bytes)
    }

    // -- settings -----------------------------------------------------------

    fn settings_path(&self, name: &str) -> Result<PathBuf> {
        let name = self.safe_component(name)?;
        if !ALLOWED_SETTINGS.contains(&name.as_str()) {
            return Err(StoreError::Invalid("not a settings file".into()));
        }
        Ok(self.root.join(name))
    }

    pub fn read_settings(&self, name: &str) -> Result<Option<Vec<u8>>> {
        read_opt(&self.settings_path(name)?)
    }

    pub fn write_settings(&self, name: &str, bytes: &[u8]) -> Result<()> {
        let path = self.settings_path(name)?;
        atomic_write(&self.root, &path, bytes)
    }
}

fn read_opt(path: &Path) -> Result<Option<Vec<u8>>> {
    match std::fs::read(path) {
        Ok(b) => Ok(Some(b)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// write-temp → fsync → rename, so a reader never sees a half-written file and
/// a crash mid-write leaves either the old bytes or the new, never garbage.
fn atomic_write(root: &Path, target: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = root.join(format!(".tmp-{}", b32(&random_32()[..8])));
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, target)?;
    Ok(())
}
