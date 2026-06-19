// Local-folder `StorageAdapter`, built on the shared directory adapter so it
// stores each note as an individual markdown file inside a user-picked
// directory (via the File System Access API). The directory is acquired by
// the App layer through `showDirectoryPicker` and persisted in IndexedDB (see
// `handle-store.ts`); this module only sees a live handle.
//
// Layout: the default namespace holds its note `<slug>.md` files directly in
// the picked directory; every other namespace gets its own subfolder
// (`<picked>/<slug>/<note>.md`) so a whole namespace folder can be shared on
// its own. Beside them at the picked-directory root sit `settings.json`
// (appearance), `namespaces.json` (the namespace registry), and, when
// encryption is on, `notes.json` (the AES-GCM envelope). That keeps the
// markdown files browsable, git-trackable, and editable by any other tool —
// the whole point of the folder backend.
//
// Notes are stored flat (one `.md` per note, no nesting), so each file store
// enumerates only the files directly in its base directory: the namespace's
// subfolder, or the picked-directory root for the default namespace — which
// also keeps the default namespace from picking up other namespaces' folders.
//
// Concurrency rides on each file's `lastModified` ms timestamp, surfaced to
// the directory adapter as the per-file revision; the adapter folds the
// directory's files into one aggregate revision and detects drift from it.

import { createLogger } from "../../dev/logger.ts";
import type { StorageAdapter } from "../adapter.ts";
import type { AttachmentEntry, AttachmentStore } from "../attachment-store.ts";
import { createDirectoryAdapter } from "../directory-adapter.ts";
import type { FileEntry, FileStore } from "../file-store.ts";
import {
  DEFAULT_NAMESPACE_SLUG,
  namespaceAttachmentsFolder,
  namespaceNotesFolder,
} from "../namespaces.ts";
import {
  fileNamespaceStore,
  type NamespaceRegistryStore,
} from "../namespace-store.ts";
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
  /**
   * Which namespace's notes this adapter reads/writes. Defaults to the
   * default namespace, whose files live directly in the picked directory.
   */
  namespace?: string;
  // Fires once when an operation fails because the OS-level permission was
  // revoked between sessions, so the App can clear the in-state handle and
  // surface a reconnect banner without awaiting the next operation.
  onPermissionLost?: () => void;
};

class FolderFileStore implements FileStore {
  // The folder segments this store is rooted at, relative to the picked
  // directory: `notes` / `<slug>` `notes` for a namespace's documents, or
  // empty for the registry / settings stores that root at the picked
  // directory itself.
  private readonly baseSegments: string[];

  constructor(
    private readonly root: FileSystemDirectoryHandle,
    base: string = "",
    private readonly onPermissionLost?: () => void,
  ) {
    this.baseSegments = base.split("/").filter((s) => s.length > 0);
  }

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

  // Prepend the store's base to a relative path's segments.
  private segmentsFor(path: string): string[] {
    return [...this.baseSegments, ...path.split("/")].filter(
      (s) => s.length > 0,
    );
  }

  private async resolveParent(
    path: string,
    create: boolean,
  ): Promise<{ dir: FileSystemDirectoryHandle; name: string } | null> {
    const segments = this.segmentsFor(path);
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

  // List the files directly in the base directory (the namespace's subfolder,
  // or the picked-directory root for the default namespace). Notes are flat,
  // so directories — other namespaces' folders when listing at the root — are
  // skipped rather than descended into.
  async list(): Promise<FileEntry[]> {
    const dir = await this.resolveDir(this.baseSegments, false);
    if (!dir) return [];
    const out: FileEntry[] = [];
    try {
      for await (const handle of dir.values()) {
        if (handle.kind !== "file") continue;
        const file = await handle.getFile();
        out.push({ path: handle.name, rev: String(file.lastModified) });
      }
    } catch (err) {
      this.reportPermission(err);
      throw err;
    }
    return out;
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

  async write(path: string, text: string): Promise<string | undefined> {
    const parent = await this.resolveParent(path, true);
    if (!parent) throw new Error(`folder: cannot resolve ${path}`);
    try {
      const handle = await parent.dir.getFileHandle(parent.name, {
        create: true,
      });
      const writable = await handle.createWritable({ keepExistingData: false });
      await writable.write(text);
      await writable.close();
      // The fresh `lastModified` is the per-file revision `list()` reports, so
      // hand it back for the adapter's post-save aggregate.
      return String((await handle.getFile()).lastModified);
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

// Binary attachment store for the folder backend: each note's images under
// `<picked>/attachments/<note-name>/` (or `<slug>/attachments/...`). Shares the
// folder backend's directory-resolution and permission-loss reporting, but
// moves bytes (an image) rather than UTF-8 markdown.
class FolderAttachmentStore implements AttachmentStore {
  private readonly baseSegments: string[];

  constructor(
    private readonly root: FileSystemDirectoryHandle,
    base: string,
    private readonly onPermissionLost?: () => void,
  ) {
    this.baseSegments = base.split("/").filter((s) => s.length > 0);
  }

  private reportPermission(err: unknown): void {
    if (isPermissionError(err)) {
      log.error("permission lost", err);
      this.onPermissionLost?.();
    }
  }

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

  private segmentsFor(path: string): string[] {
    return [...this.baseSegments, ...path.split("/")].filter(
      (s) => s.length > 0,
    );
  }

  // Walk the `attachments/` tree (note-name subfolders, each holding image
  // files) into flat `<note-name>/<file>` paths.
  async list(): Promise<AttachmentEntry[]> {
    const dir = await this.resolveDir(this.baseSegments, false);
    if (!dir) return [];
    const out: AttachmentEntry[] = [];
    try {
      for await (const sub of dir.values()) {
        if (sub.kind !== "directory") continue;
        for await (const file of sub.values()) {
          if (file.kind !== "file") continue;
          out.push({ path: `${sub.name}/${file.name}` });
        }
      }
    } catch (err) {
      this.reportPermission(err);
      throw err;
    }
    return out;
  }

  async read(path: string): Promise<Uint8Array | null> {
    const segments = this.segmentsFor(path);
    const name = segments.pop();
    if (!name) return null;
    const dir = await this.resolveDir(segments, false);
    if (!dir) return null;
    try {
      const handle = await dir.getFileHandle(name, { create: false });
      const buffer = await (await handle.getFile()).arrayBuffer();
      return new Uint8Array(buffer);
    } catch (err) {
      if (isNotFoundError(err)) return null;
      this.reportPermission(err);
      throw err;
    }
  }

  async write(path: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    const segments = this.segmentsFor(path);
    const name = segments.pop();
    if (!name) throw new Error(`folder: cannot resolve ${path}`);
    const dir = await this.resolveDir(segments, true);
    if (!dir) throw new Error(`folder: cannot resolve ${path}`);
    try {
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable({ keepExistingData: false });
      await writable.write(bytes);
      await writable.close();
    } catch (err) {
      this.reportPermission(err);
      throw err;
    }
  }

  async remove(path: string): Promise<void> {
    const segments = this.segmentsFor(path);
    const name = segments.pop();
    if (!name) return;
    const dir = await this.resolveDir(segments, false);
    if (!dir) return;
    try {
      await dir.removeEntry(name);
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
  const namespace = options.namespace ?? DEFAULT_NAMESPACE_SLUG;
  log.info(`adapter created ns=${namespace}`);
  const store = new FolderFileStore(
    options.directoryHandle,
    namespaceNotesFolder(namespace),
    options.onPermissionLost,
  );
  const attachments = new FolderAttachmentStore(
    options.directoryHandle,
    namespaceAttachmentsFolder(namespace),
    options.onPermissionLost,
  );
  return createDirectoryAdapter(
    store,
    {
      id: "folder",
      label: "Local folder",
      saveDebounceMs: SAVE_DEBOUNCE_MS,
    },
    attachments,
  );
}

// Settings store for the folder backend: `settings.json` at the picked
// directory root, beside the namespace folders. Built with no namespace so
// the file store resolves at the root.
export function createFolderSettingsStore(
  directoryHandle: FileSystemDirectoryHandle,
  onPermissionLost?: () => void,
): SettingsStore {
  return fileSettingsStore(
    new FolderFileStore(directoryHandle, "", onPermissionLost),
  );
}

// Root namespace-registry store for the folder backend: `namespaces.json` at
// the picked directory root, beside `settings.json` and the namespace
// folders. Built with no namespace so the file store resolves at the root.
export function createFolderNamespaceStore(
  directoryHandle: FileSystemDirectoryHandle,
  onPermissionLost?: () => void,
): NamespaceRegistryStore {
  return fileNamespaceStore(
    new FolderFileStore(directoryHandle, "", onPermissionLost),
  );
}
