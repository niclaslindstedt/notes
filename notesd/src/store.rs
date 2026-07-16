//! The dumb file store over the served folder.
//!
//! This is byte-compatible with the app's directory format
//! (`src/storage/directory-adapter.ts`): each namespace keeps its note files
//! under a `notes/` subfolder (`notes/` for the default namespace,
//! `<slug>/notes/` for the rest) and its image attachments under the sibling
//! `attachments/` subfolder, exactly the layout the folder / Dropbox / Drive
//! backends write. The root also holds `settings.json` / `namespaces.json`. The
//! daemon never parses any of it — a file is just a path, some bytes, and a
//! content hash. That's the whole point: the folder neither knows nor cares
//! whether the client encrypts, nor which subfolder is a namespace.
//!
//! Because the client owns that folder convention, the store's real surface is
//! a **generic blob store** keyed by a safe relative path (`read_blob` /
//! `write_blob` / `delete_blob` / `list_blobs`): the directory adapter drives
//! notes through `notes/…` paths and attachments through `attachments/…` paths,
//! and the store just moves bytes. The older whole-document note API
//! (`read_note` / `write_note`, single-file `document.json`) is kept for the v1
//! adapter and the delta protocol.
//!
//! Every path that comes off the wire is validated segment by segment before it
//! touches disk (no empty segments, no `.`/`..`, only `[A-Za-z0-9._-]`), so a
//! crafted path can never escape the folder. A leading dot **is** allowed on a
//! filename because the directory adapter keeps two real sidecars in the notes
//! folder — `.keyparams.json` (the encryption KDF salts) and `.index.bin` (the
//! encrypted note index) — that the daemon must be able to store and serve; only
//! the daemon's own `.tmp-*` atomic-write scratch files are hidden from
//! listings. Writes are atomic: write-temp → fsync → rename.

use std::io::Write;
use std::path::{Path, PathBuf};

use crate::secret::{b32, random_32, sha256_hex};

/// Files at the root that are settings, not notes — excluded from listings and
/// rejected as note/blob refs so the two namespaces never collide.
pub const RESERVED: &[&str] = &["settings.json", "namespaces.json"];

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
    /// not `.` or `..` and no embedded `..`, only `[A-Za-z0-9._-]`. A leading dot
    /// is permitted (the `.keyparams.json` / `.index.bin` sidecars) but traversal
    /// never is.
    fn safe_component(&self, part: &str) -> Result<String> {
        if part.is_empty() || part.len() > 255 {
            return Err(StoreError::Invalid("invalid name length".into()));
        }
        if part == "." || part == ".." || part.contains("..") {
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

    /// Validate a `/`-separated relative path segment by segment (each via
    /// [`Self::safe_component`], so no empty segment, `..`, leading dot, or
    /// illegal character survives), and return it normalised. This is what makes
    /// the store safe for the nested `notes/…` and `attachments/…` layout the
    /// directory adapter writes, while still refusing any traversal out of the
    /// folder.
    fn safe_relpath(&self, path: &str) -> Result<String> {
        if path.is_empty() {
            return Err(StoreError::Invalid("empty path".into()));
        }
        let mut parts = Vec::new();
        for seg in path.split('/') {
            parts.push(self.safe_component(seg)?);
        }
        Ok(parts.join("/"))
    }

    /// The on-disk path for a note ref, validated. Rejects reserved settings
    /// names so a note write can't clobber `settings.json`. Accepts the nested
    /// `notes/<file>` refs the directory adapter uses as well as a bare root
    /// file (the v1 whole-document `document.json`).
    fn note_path(&self, reference: &str) -> Result<PathBuf> {
        let rel = self.safe_relpath(reference)?;
        if RESERVED.contains(&rel.as_str()) {
            return Err(StoreError::Invalid("reserved name is not a note".into()));
        }
        Ok(self.root.join(rel))
    }

    /// The on-disk path for a generic blob ref (a note or an attachment at any
    /// namespace-scoped relative path), validated and guarded against clobbering
    /// the reserved root settings files.
    fn blob_path(&self, path: &str) -> Result<PathBuf> {
        let rel = self.safe_relpath(path)?;
        if RESERVED.contains(&rel.as_str()) {
            return Err(StoreError::Invalid("reserved name is not a blob".into()));
        }
        Ok(self.root.join(rel))
    }

    /// The on-disk directory a listing prefix resolves to. An empty (or `/`)
    /// prefix is the folder root; otherwise the trailing slash is dropped and the
    /// remainder validated as a relative path.
    fn blob_dir(&self, prefix: &str) -> Result<PathBuf> {
        let trimmed = prefix.trim_end_matches('/');
        if trimmed.is_empty() {
            return Ok(self.root.clone());
        }
        Ok(self.root.join(self.safe_relpath(trimmed)?))
    }

    // -- notes (v1 whole-document + delta protocol) -------------------------

    /// List every file under the folder (recursively), excluding reserved root
    /// settings files, dotfiles, and the temp files an in-flight atomic write
    /// leaves behind. Each entry's `reference` is its path relative to the folder
    /// root (POSIX `/`), and `etag` its content hash. Feeds the revision index
    /// (bootstrap + fs-watch reconcile) so an out-of-band edit anywhere in the
    /// tree — a note in `notes/`, another namespace's `<slug>/notes/` — is
    /// picked up.
    pub fn list(&self) -> Result<Vec<NoteMeta>> {
        self.list_blobs("", true)
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
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        atomic_write(&self.root, &path, bytes)?;
        Ok(sha256_hex(bytes))
    }

    /// Delete a note. Returns whether it existed. Attachment cleanup is the
    /// client's job (its save reconciles orphaned attachment files), so this
    /// only removes the one file and prunes any now-empty parent folders.
    pub fn delete_note(&self, reference: &str) -> Result<bool> {
        remove_and_prune(&self.root, &self.note_path(reference)?)
    }

    // -- generic blobs (notes + attachments, namespace-scoped) --------------

    /// List every file whose path starts with `prefix` (a folder path such as
    /// `notes/` or `attachments/` or `<slug>/notes/`), returning each path
    /// relative to the folder root. When `with_etag` is false the content hash is
    /// skipped — an attachment listing wants only the paths and shouldn't pay to
    /// read every image's bytes. Reserved root settings files, dotfiles, and
    /// temp files are always excluded.
    pub fn list_blobs(&self, prefix: &str, with_etag: bool) -> Result<Vec<NoteMeta>> {
        let dir = self.blob_dir(prefix)?;
        let mut out = Vec::new();
        self.walk(&dir, with_etag, &mut out)?;
        out.sort_by(|a, b| a.reference.cmp(&b.reference));
        Ok(out)
    }

    /// Read one blob's bytes, or `None` if absent.
    pub fn read_blob(&self, path: &str) -> Result<Option<Vec<u8>>> {
        read_opt(&self.blob_path(path)?)
    }

    /// Atomically write a blob's bytes (creating parent folders), returns the
    /// new etag.
    pub fn write_blob(&self, path: &str, bytes: &[u8]) -> Result<String> {
        let target = self.blob_path(path)?;
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        atomic_write(&self.root, &target, bytes)?;
        Ok(sha256_hex(bytes))
    }

    /// Delete a blob, pruning any now-empty parent folders. Returns whether it
    /// existed.
    pub fn delete_blob(&self, path: &str) -> Result<bool> {
        remove_and_prune(&self.root, &self.blob_path(path)?)
    }

    /// Recursively collect every file under `dir`, relative to the folder root.
    fn walk(&self, dir: &Path, with_etag: bool, out: &mut Vec<NoteMeta>) -> Result<()> {
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e.into()),
        };
        for entry in entries {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            let meta = entry.metadata()?;
            let path = entry.path();
            if meta.is_dir() {
                // Don't descend into a dot-directory (a stray `.git` / `.trash`
                // if the folder is pointed at a repo); the app keeps none of its
                // own. Its real content is all in `notes/` / `attachments/`.
                if !name.starts_with('.') {
                    self.walk(&path, with_etag, out)?;
                }
                continue;
            }
            if !meta.is_file() {
                continue;
            }
            // Hide only the daemon's own atomic-write scratch files; the app's
            // `.keyparams.json` / `.index.bin` sidecars are real content.
            if name.starts_with(".tmp-") {
                continue;
            }
            let rel = match path.strip_prefix(&self.root) {
                Ok(rel) => rel.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };
            if RESERVED.contains(&rel.as_str()) {
                continue;
            }
            let etag = if with_etag {
                sha256_hex(&std::fs::read(&path)?)
            } else {
                String::new()
            };
            out.push(NoteMeta {
                etag,
                reference: rel,
            });
        }
        Ok(())
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

/// Remove a file, then walk its parent folders up to (but not including) `root`,
/// dropping each one that is now empty. A missing file is "already gone"
/// (`false`). Keeps the folder from accumulating empty `notes/` /
/// `attachments/<stem>/` directories after a note or a whole namespace is
/// deleted, without ever touching a folder that still holds other files.
fn remove_and_prune(root: &Path, target: &Path) -> Result<bool> {
    let existed = match std::fs::remove_file(target) {
        Ok(()) => true,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
        Err(e) => return Err(e.into()),
    };
    let mut cursor = target.parent().map(Path::to_path_buf);
    while let Some(dir) = cursor {
        if dir == root || !dir.starts_with(root) {
            break;
        }
        // `remove_dir` only succeeds on an empty directory; a non-empty one (or a
        // race) stops the prune, which is exactly what we want.
        if std::fs::remove_dir(&dir).is_err() {
            break;
        }
        cursor = dir.parent().map(Path::to_path_buf);
    }
    Ok(existed)
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
