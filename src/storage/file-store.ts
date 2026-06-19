// The small contract a file-based backend implements so the shared
// directory adapter (`./directory-adapter.ts`) can store a document as a
// folder of individual markdown files. Each backend (local folder, Dropbox,
// Google Drive) only has to move bytes for a single relative path; the
// markdown <-> snapshot conversion, the encrypted-blob fallback, and conflict
// detection all live once in the directory adapter.
//
// Paths are POSIX-style and relative to the backend's app-folder root (a
// note's `<stem>.md`, or `notes.json`). Each store prepends its own root:
// the folder backend the picked handle, Dropbox the app folder, Drive the
// `notes/` app folder.

/** A file's path plus an opaque per-file revision used to detect drift. */
export type FileEntry = {
  path: string;
  // Backend-defined token that changes when the file's bytes change: a
  // folder mtime, a Dropbox `rev`, a Drive version. Used only to build the
  // directory's aggregate revision — never interpreted.
  rev?: string;
};

export interface FileStore {
  /** Every file under the root, with its current revision. */
  list(): Promise<FileEntry[]>;
  /** Read one file's bytes, or null when it doesn't exist. */
  read(path: string): Promise<string | null>;
  /**
   * Write (create or overwrite) one file, returning the same per-file
   * revision `list()` would report for the bytes just written — Dropbox's new
   * `rev`, Drive's bumped `version`, the folder's fresh `lastModified`. The
   * directory adapter uses it to build the post-save aggregate revision
   * *without* a follow-up `list()`, whose cloud endpoints lag a write by a
   * moment and would otherwise stamp a stale revision the next save misreads
   * as a remote edit. Returns `undefined` only when a backend genuinely can't
   * report one; the adapter then falls back to re-listing.
   */
  write(path: string, text: string): Promise<string | undefined>;
  /** Delete one file. A missing file is treated as already gone. */
  remove(path: string): Promise<void>;
}
