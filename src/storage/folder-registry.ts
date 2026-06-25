// The folder-registry concern for the directory adapter: the `folders.json`
// sidecar that carries folder display names and any empty folders, plus the
// in-memory state derived from it. Lifted out of `directory-adapter.ts` so the
// adapter's load / save paths share a single source of truth for the registry
// (the invariant that the load's `readFolders`, the save's `rememberFolders`,
// and the per-note `plaintextNotePath` all agree on the same folder list), and
// so the read-retry / persist-skip logic is testable in isolation.
//
// Notes carry only a folder *id* in their frontmatter; this sidecar maps id →
// name and keeps a folder that holds no notes — neither of which a notes-only
// reconstruction from the `.md` / `.enc` files could recover.

import { isEncryptedEnvelope } from "./crypto.ts";
import type { FileStore } from "./file-store.ts";
import { noteFilePath } from "./markdown/codec.ts";
import {
  parse,
  parseFolders,
  serialize,
  serializeFolders,
} from "./serialize.ts";
import type { Folder, Note, Snapshot } from "../domain/note.ts";
import { createLogger } from "../dev/logger.ts";

const log = createLogger("sync");

// The folder registry sidecar (display names + empty folders), beside the note
// files in the namespace's notes folder. Like the namespace / settings
// registries it's plaintext JSON — folder names aren't secret, and a note's
// `folder` frontmatter only carries the id — and metadata, not a note: it's
// never read as a note nor removed on a representation switch.
export const FOLDERS_FILE_NAME = "folders.json";

// The folder sidecar read is retried so a transient cloud failure (a cold-start
// 429 from the load's request burst, a dropped request) isn't mistaken for "no
// folders" — which would drop the whole registry. A few short, backing-off
// attempts comfortably outlast a brief rate-limit window without stalling a
// genuinely folder-less load for long.
const FOLDERS_READ_ATTEMPTS = 3;
const FOLDERS_READ_BACKOFF_MS = 250;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Fold the registry's folders into a snapshot's text on load — the notes are
// rebuilt from the `.md` / `.enc` files and carry only a folder *id*, so the
// names (and any empty folders) come from the sidecar. The legacy single-blob
// envelope is opaque, so it's left untouched. Pure: it takes the folders
// explicitly rather than reading the registry's state.
export function injectFolders(
  text: string,
  folders: readonly Folder[],
): string {
  if (folders.length === 0 || isEncryptedEnvelope(text)) return text;
  const snap = parse(text);
  snap.folders = [...folders];
  return serialize(snap);
}

export type FolderRegistry = {
  // Read the folder registry sidecar, tolerating a missing file by yielding no
  // folders and a failed read by keeping the last known folders (see below).
  readFolders(): Promise<Folder[]>;
  // Write the folder registry sidecar when it changed.
  persistFolders(snapshot: Snapshot | null): Promise<void>;
  // The path a note's plaintext `.md` file lives at, folder-aware — resolved
  // against the last-known registry the same way `snapshotToFiles` does.
  plaintextNotePath(note: Note): string;
  // Remember the registry from a save's snapshot so the per-note migrate /
  // demigrate paths (which only receive a `Note`) resolve folder dirs the same
  // way the save does.
  rememberFolders(folders: readonly Folder[]): void;
  // Whether the last `readFolders` actually read the sidecar (vs. a thrown,
  // retried-out failure). The load uses this to avoid memoizing a registry it
  // couldn't actually read.
  readOk(): boolean;
};

export type FolderRegistryDeps = {
  store: FileStore;
  // Backend id, only used to scope log lines.
  id: string;
};

export function createFolderRegistry(deps: FolderRegistryDeps): FolderRegistry {
  const { store, id } = deps;

  // The canonical JSON of the folder registry as it currently stands on disk
  // (null = no `folders.json` sidecar exists). Set on every load and after each
  // write so `persistFolders` skips a redundant rewrite when nothing changed.
  let lastFoldersJson: string | null = null;

  // The folder registry from the last load / save, kept so the per-note
  // encryption migrate / demigrate paths (which only receive a `Note`) can
  // resolve a note's physical folder directory. The plaintext `.md` of a
  // grouped note lives at `<folder-dir>/<stem>.md`.
  let lastFolders: Folder[] = [];

  // Whether the last `readFolders` actually read the sidecar (vs. a thrown,
  // retried-out failure). When false the load isn't memoized, so a transient
  // read failure can't cache a folderless registry — a later refresh re-reads
  // it instead of the adapter having to be rebuilt.
  let foldersReadOk = true;

  // Read the folder registry sidecar, tolerating a missing file by yielding no
  // folders. Records the canonical bytes so the next save can tell whether the
  // registry actually changed, and sets `foldersReadOk` so the caller can avoid
  // memoizing (or persisting over) a registry it couldn't actually read.
  //
  // The sidecar is read directly rather than gated on the directory listing: a
  // cloud `list()` is only eventually consistent — right after startup Dropbox's
  // `list_folder` can omit `folders.json` even though it's really there — while
  // a read of a known path is strongly consistent. The folders are the
  // registry's, so this also keeps *empty* folders — the ones no note links to —
  // which a notes-only reconstruction would lose.
  //
  // A *failed* read (a thrown error — a cold-start 429 from the load's request
  // burst, a dropped request) is NOT "no folders": treating it as empty dropped
  // the whole registry and the load memo cached that folderless snapshot until
  // the adapter was rebuilt (the "switch namespaces back and forth" workaround).
  // So the read is retried a few times, and if it still fails the previously
  // known folders are kept and `foldersReadOk` is cleared so the load isn't
  // memoized and a later refresh re-reads instead of serving the empty result.
  async function readFolders(): Promise<Folder[]> {
    let raw: string | null = null;
    foldersReadOk = false;
    for (let attempt = 0; attempt < FOLDERS_READ_ATTEMPTS; attempt += 1) {
      try {
        raw = await store.read(FOLDERS_FILE_NAME);
        foldersReadOk = true;
        break;
      } catch (err) {
        log.warn(
          `${id} folders: read failed (attempt ${attempt + 1}/${FOLDERS_READ_ATTEMPTS})`,
          err,
        );
        if (attempt < FOLDERS_READ_ATTEMPTS - 1) {
          await sleep(FOLDERS_READ_BACKOFF_MS * (attempt + 1));
        }
      }
    }
    if (!foldersReadOk) {
      // Couldn't read the sidecar — keep whatever we last knew rather than
      // clobbering it with an empty registry the listing can't vouch for.
      log.warn(
        `${id} folders: read failed — keeping ${lastFolders.length} known folder(s)`,
      );
      return lastFolders;
    }
    if (raw === null) {
      lastFoldersJson = null;
      lastFolders = [];
      return [];
    }
    let folders: Folder[];
    try {
      folders = parseFolders(JSON.parse(raw));
    } catch {
      folders = [];
    }
    lastFoldersJson = serializeFolders(folders);
    lastFolders = folders;
    log.info(`${id} folders: read ${folders.length}`);
    return folders;
  }

  // Write the folder registry sidecar when it changed. Writes `[]` to clear a
  // sidecar whose folders were all removed; skips entirely on a folder-less
  // document that never had one, so a plain note folder gains no stray file.
  async function persistFolders(snapshot: Snapshot | null): Promise<void> {
    if (!snapshot) return;
    const folders = snapshot.folders ?? [];
    if (folders.length === 0 && lastFoldersJson === null) return;
    const json = serializeFolders(folders);
    if (json === lastFoldersJson) return;
    await store.write(FOLDERS_FILE_NAME, json);
    lastFoldersJson = json;
  }

  function plaintextNotePath(note: Note): string {
    return noteFilePath(note, lastFolders);
  }

  function rememberFolders(folders: readonly Folder[]): void {
    lastFolders = [...folders];
  }

  return {
    readFolders,
    persistFolders,
    plaintextNotePath,
    rememberFolders,
    readOk: () => foldersReadOk,
  };
}
