// Wraps any `FileStore` into a `StorageAdapter`, storing the document as a
// folder of individual markdown files (one per note). This is the single
// place the file-based backends — local folder, Dropbox, Google Drive —
// share, so the markdown representation, the encrypted single-file fallback,
// and conflict detection are implemented once rather than per backend.
//
// Bytes in, bytes out: the adapter still speaks the `StorageAdapter` contract
// (serialized JSON text on `save`, the same back on `load`), so nothing
// upstream — the encryption wrapper, the sync engine — changes. The markdown
// lives only on disk.
//
//   - load():  read every `*.md` file → reconstruct the snapshot →
//              re-serialize to canonical JSON for the pipeline. If there are
//              no markdown files but a `notes.json` exists (an encrypted
//              envelope), return that file verbatim.
//   - save():  plaintext JSON → markdown files (writing changed files,
//              deleting removed ones, and clearing any `notes.json`). An
//              encrypted envelope can't be split, so it's stored whole in
//              `notes.json` and the markdown files are cleared.
//
// Concurrency uses an aggregate revision built from the per-file revisions
// the store reports for the whole directory; a save re-lists first and raises
// `ConflictError` when the aggregate moved past the caller's `baseRevision`.

import type { StorageAdapter, StoredSnapshot } from "./adapter.ts";
import { ConflictError } from "./adapter.ts";
import { isEncryptedEnvelope } from "./crypto.ts";
import type { FileEntry, FileStore } from "./file-store.ts";
import { filesToSnapshot, snapshotToFiles } from "./markdown/codec.ts";
import { parse, serialize } from "./serialize.ts";

// Single-file location for bytes that can't be expressed as markdown: an
// AES-GCM envelope (encryption on).
export const BLOB_FILE_NAME = "notes.json";

function isMarkdownPath(path: string): boolean {
  return path.endsWith(".md");
}

// Build the directory's aggregate revision from the per-file revisions.
// Order-independent (sorted) so two listings of the same bytes compare equal
// regardless of the order the backend returned them in.
function aggregateRevision(entries: readonly FileEntry[]): string {
  return entries
    .filter((e) => isMarkdownPath(e.path) || e.path === BLOB_FILE_NAME)
    .map((e) => `${e.path}:${e.rev ?? ""}`)
    .sort()
    .join("\n");
}

export type DirectoryAdapterOptions = {
  id: StorageAdapter["id"];
  label: string;
  saveDebounceMs?: number;
};

export function createDirectoryAdapter(
  store: FileStore,
  options: DirectoryAdapterOptions,
): StorageAdapter {
  async function readSnapshotText(
    entries: readonly FileEntry[],
  ): Promise<string | null> {
    const mdPaths = entries.map((e) => e.path).filter(isMarkdownPath);
    if (mdPaths.length > 0) {
      const files = await Promise.all(
        mdPaths.map(async (path) => ({
          path,
          text: (await store.read(path)) ?? "",
        })),
      );
      return serialize(filesToSnapshot(files));
    }
    // No markdown yet: fall back to the single-file blob (an encrypted
    // envelope). Returned verbatim so the pipeline can decrypt it.
    if (entries.some((e) => e.path === BLOB_FILE_NAME)) {
      return store.read(BLOB_FILE_NAME);
    }
    return null;
  }

  async function load(): Promise<StoredSnapshot | null> {
    const entries = await store.list();
    const text = await readSnapshotText(entries);
    if (text === null) return null;
    return { text, revision: aggregateRevision(entries) };
  }

  async function save(
    text: string,
    baseRevision?: string,
  ): Promise<StoredSnapshot> {
    const before = await store.list();
    if (baseRevision !== undefined) {
      const current = aggregateRevision(before);
      if (current !== baseRevision) {
        const remoteText = await readSnapshotText(before);
        throw new ConflictError({
          text: remoteText ?? serialize(parse(null)),
          revision: current,
        });
      }
    }

    const existingMd = new Set(
      before.map((e) => e.path).filter(isMarkdownPath),
    );
    const hasBlob = before.some((e) => e.path === BLOB_FILE_NAME);

    if (isEncryptedEnvelope(text)) {
      // Can't express an envelope as markdown — store it whole and drop any
      // markdown files so the two representations can't disagree.
      await store.write(BLOB_FILE_NAME, text);
      await Promise.all([...existingMd].map((path) => store.remove(path)));
    } else {
      const files = snapshotToFiles(parse(text));
      const desired = new Set(files.map((f) => f.path));
      await Promise.all(files.map((f) => store.write(f.path, f.text)));
      const removals = [...existingMd].filter((p) => !desired.has(p));
      if (hasBlob) removals.push(BLOB_FILE_NAME);
      await Promise.all(removals.map((path) => store.remove(path)));
    }

    const after = await store.list();
    return { text, revision: aggregateRevision(after) };
  }

  return {
    id: options.id,
    label: options.label,
    saveDebounceMs: options.saveDebounceMs,
    capabilities: new Set(),
    load,
    save,
  };
}
