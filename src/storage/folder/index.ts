// Local-folder `StorageAdapter`, built on the shared directory adapter so it
// stores each note as an individual markdown file inside a user-picked
// directory (via the File System Access API). The directory is acquired by
// the App layer through `showDirectoryPicker` and persisted in IndexedDB (see
// `handle-store.ts`); this module only sees a live handle.
//
// Layout: the picked directory holds the note `<slug>.md` files directly,
// plus `settings.json` (appearance) and, when encryption is on, `notes.json`
// (the AES-GCM envelope). That keeps the markdown files browsable,
// git-trackable, and editable by any other tool — the whole point of the
// folder backend.
//
// Concurrency rides on each file's `lastModified` ms timestamp, surfaced to
// the directory adapter as the per-file revision; the adapter folds the
// directory's files into one aggregate revision and detects drift from it.

import { createLogger } from "../../dev/logger.ts";
import type { StorageAdapter } from "../adapter.ts";
import { createDirectoryAdapter } from "../directory-adapter.ts";
import type { FileEntry, FileStore } from "../file-store.ts";
import { fileSettingsStore, type SettingsStore } from "../settings-store.ts";

const log = createLogger("folder");

const SAVE_DEBOUNCE_MS = 500;

function isNotFoundError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotFoundError";
}

// Chrome reports a revoked grant as `NotAllowedError` / `SecurityError`. The
// caller flips to the "Reconnect folder" cue when it sees one.
function isPermissionError(err: unknown): boolean {
  if (!(err instanceof DOMException)) return false;
  return err.name === "NotAllowedError" || err.name === "SecurityError";
}

export type CreateFolderAdapterOptions = {
  directoryHandle: FileSystemDirectoryHandle;
  // Fires once when an operation fails because the OS-level permission was
  // revoked between sessions, so the App can clear the in-state handle and
  // surface a reconnect banner without awaiting the next operation.
  onPermissionLost?: () => void;
};

class FolderFileStore implements FileStore {
  constructor(
    private readonly root: FileSystemDirectoryHandle,
    private readonly onPermissionLost?: () => void,
  ) {}

  // Resolve the directory handle for a `/`-separated path, optionally creating
  // each segment. Returns null when a segment is missing and `create` is false.
  private async resolveDir(
    segments: string[],
    create: boolean,
  ): Promise<FileSystemDirectoryHandle | null> {
    let dir = this.root;
    for (const segment of segments.filter((s) => s.length > 0)) {
      try {
        dir = await dir.getDirectoryHandle(segment, { create });
      } catch (err) {
        if (isNotFoundError(err)) return null;
        this.reportPermission(err);
        throw err;
      }
    }
    return dir;
  }

  private async resolveParent(
    path: string,
    create: boolean,
  ): Promise<{ dir: FileSystemDirectoryHandle; name: string } | null> {
    const segments = path.split("/").filter((s) => s.length > 0);
    const name = segments.pop();
    if (!name) return null;
    const dir = await this.resolveDir(segments, create);
    return dir ? { dir, name } : null;
  }

  private reportPermission(err: unknown): void {
    if (isPermissionError(err)) {
      log.error("permission lost", err);
      this.onPermissionLost?.();
    }
  }

  async list(): Promise<FileEntry[]> {
    const entries: FileEntry[] = [];
    await this.walk(this.root, "", entries);
    return entries;
  }

  private async walk(
    dir: FileSystemDirectoryHandle,
    prefix: string,
    out: FileEntry[],
  ): Promise<void> {
    try {
      for await (const handle of dir.values()) {
        const path = prefix ? `${prefix}/${handle.name}` : handle.name;
        if (handle.kind === "directory") {
          await this.walk(handle, path, out);
        } else {
          const file = await handle.getFile();
          out.push({ path, rev: String(file.lastModified) });
        }
      }
    } catch (err) {
      this.reportPermission(err);
      throw err;
    }
  }

  async read(path: string): Promise<string | null> {
    const parent = await this.resolveParent(path, false);
    if (!parent) return null;
    try {
      const handle = await parent.dir.getFileHandle(parent.name, {
        create: false,
      });
      return await (await handle.getFile()).text();
    } catch (err) {
      if (isNotFoundError(err)) return null;
      this.reportPermission(err);
      throw err;
    }
  }

  async write(path: string, text: string): Promise<void> {
    const parent = await this.resolveParent(path, true);
    if (!parent) throw new Error(`folder: cannot resolve ${path}`);
    try {
      const handle = await parent.dir.getFileHandle(parent.name, {
        create: true,
      });
      const writable = await handle.createWritable({ keepExistingData: false });
      await writable.write(text);
      await writable.close();
    } catch (err) {
      this.reportPermission(err);
      throw err;
    }
  }

  async remove(path: string): Promise<void> {
    const parent = await this.resolveParent(path, false);
    if (!parent) return;
    try {
      await parent.dir.removeEntry(parent.name);
    } catch (err) {
      if (isNotFoundError(err)) return;
      this.reportPermission(err);
      throw err;
    }
  }
}

export function createFolderAdapter(
  options: CreateFolderAdapterOptions,
): StorageAdapter {
  log.info("adapter created");
  const store = new FolderFileStore(
    options.directoryHandle,
    options.onPermissionLost,
  );
  return createDirectoryAdapter(store, {
    id: "folder",
    label: "Local folder",
    saveDebounceMs: SAVE_DEBOUNCE_MS,
  });
}

// Settings store for the folder backend: `settings.json` at the picked
// directory root, beside the note markdown files.
export function createFolderSettingsStore(
  directoryHandle: FileSystemDirectoryHandle,
  onPermissionLost?: () => void,
): SettingsStore {
  return fileSettingsStore(
    new FolderFileStore(directoryHandle, onPermissionLost),
  );
}
