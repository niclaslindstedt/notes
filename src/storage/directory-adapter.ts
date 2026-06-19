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
//   - save():  plaintext JSON → markdown files. Only the notes whose bytes
//              changed are written, and only files this adapter itself put
//              there are removed when their note goes away.
//
// ## Per-file sync, not whole-document sync
//
// Each note is its own file with its own revision, and this adapter treats
// them independently — the design that keeps a 500-note folder usable and
// stops a single device colliding with itself:
//
//   1. **Only changed notes are written.** A save hashes each note's bytes
//      against the last copy this adapter wrote (`tracked`) and skips the
//      files that didn't move. Typing in one note re-uploads one file, not
//      the whole folder.
//   2. **Conflicts are scoped to the notes being written.** A save raises
//      `ConflictError` only when a file it is about to write or remove moved
//      on the remote since the caller's baseline — i.e. another device edited
//      *that* note. A note we aren't touching can move freely (it'll be
//      reconciled on the next load/refresh); it never blocks the save.
//   3. **We never clobber notes we didn't author.** Removals target only the
//      files this adapter has tracked, so a note another device added while
//      we were offline is left intact rather than deleted out from under it.
//   4. **Our own lag and lost acks are tolerated per file.** Cloud list
//      endpoints (Dropbox's `list_folder`, Drive's `files.list`) are
//      eventually consistent and a write's HTTP response can be lost after
//      the backend already committed it. Either way the file's revision moves
//      to a value *this* device caused. The conflict check tolerates a moved
//      revision that is one we produced for that path (lag), and tolerates a
//      file whose last write threw mid-flight (`uncertain`, a lost ack) —
//      both are our own write settling, not another device.

import type { StorageAdapter, StoredSnapshot } from "./adapter.ts";
import { ConflictError } from "./adapter.ts";
import { isEncryptedEnvelope } from "./crypto.ts";
import type { FileEntry, FileStore } from "./file-store.ts";
import { filesToSnapshot, snapshotToFiles } from "./markdown/codec.ts";
import { parse, serialize } from "./serialize.ts";
import { createLogger } from "../dev/logger.ts";

const log = createLogger("sync");

// Shorten an aggregate revision for a log line — it can be long for a
// multi-file document, and only its head and tail matter when eyeballing
// whether two revisions differ.
function shortRev(rev: string | undefined): string {
  if (rev === undefined) return "∅";
  if (rev.length <= 48) return rev;
  return `${rev.slice(0, 28)}…${rev.slice(-16)}`;
}

// Single-file location for bytes that can't be expressed as markdown: an
// AES-GCM envelope (encryption on).
export const BLOB_FILE_NAME = "notes.json";

function isMarkdownPath(path: string): boolean {
  return path.endsWith(".md");
}

// Paths this adapter owns inside the folder: a note's `*.md` file, or the
// encrypted single-file blob. Anything else in the folder is ignored.
function isOwnedPath(path: string): boolean {
  return isMarkdownPath(path) || path === BLOB_FILE_NAME;
}

// A cheap, stable content hash (djb2) used only to tell "did this note's bytes
// change since we last wrote it?" — never persisted, never compared across
// devices, so a collision at worst skips a redundant rewrite of identical
// bytes.
function hashText(text: string): number {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) {
    h = (Math.imul(h, 33) + text.charCodeAt(i)) | 0;
  }
  return h;
}

// Build the directory's aggregate revision from the per-file revisions.
// Order-independent (sorted) so two listings of the same bytes compare equal
// regardless of the order the backend returned them in. Still the adapter's
// opaque `revision` token, so the sync engine and cache wrapper are unchanged;
// it doubles as a per-file revision map the save path parses back apart.
function aggregateRevision(entries: readonly FileEntry[]): string {
  return revLines(currentRevisions(entries));
}

// The per-file revisions of a listing as a `path -> rev` map, restricted to
// the files this adapter owns.
function currentRevisions(entries: readonly FileEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    if (isOwnedPath(entry.path)) map.set(entry.path, entry.rev ?? "");
  }
  return map;
}

// Parse an aggregate revision string back into a `path -> rev` map. The
// inverse of `revLines`; lets the save path diff the caller's baseline
// per file without a second listing.
function parseRevisions(aggregate: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!aggregate) return map;
  for (const line of aggregate.split("\n")) {
    if (line === "") continue;
    const sep = line.lastIndexOf(":");
    if (sep === -1) continue;
    map.set(line.slice(0, sep), line.slice(sep + 1));
  }
  return map;
}

function revLines(revisions: ReadonlyMap<string, string>): string {
  return [...revisions]
    .map(([path, rev]) => `${path}:${rev}`)
    .sort()
    .join("\n");
}

export type DirectoryAdapterOptions = {
  id: StorageAdapter["id"];
  label: string;
  saveDebounceMs?: number;
};

// The last-known-good state of one file this adapter wrote: the content hash
// (to skip redundant rewrites) and the revision the backend reported (to
// recognise our own writes when a later listing shows them).
type Tracked = {
  hash: number;
  rev: string;
};

export function createDirectoryAdapter(
  store: FileStore,
  options: DirectoryAdapterOptions,
): StorageAdapter {
  // Per-file state this adapter has itself established, from `load` and from
  // each successful `save`. `tracked` is the baseline a save diffs against —
  // which files changed (hash) and what revision they were at (rev) — and the
  // set of files we're entitled to remove. Keyed by path; an entry is dropped
  // when its file is removed.
  const tracked = new Map<string, Tracked>();

  // Recent revisions this adapter produced for each path, newest last and
  // bounded. The conflict check consults it to tell "the backend's listing is
  // still catching up to a write of ours" (a revision we made) from "another
  // device moved this note" (a revision we never made) — see file header (4).
  const producedRevs = new Map<string, string[]>();
  const MAX_TRACKED_REVS = 6;
  function rememberRev(path: string, rev: string): void {
    const list = producedRevs.get(path) ?? [];
    if (list[list.length - 1] === rev) return;
    list.push(rev);
    if (list.length > MAX_TRACKED_REVS) list.shift();
    producedRevs.set(path, list);
  }

  // Paths whose most recent write threw mid-flight (a lost ack: the backend
  // may have committed the bytes but the response never arrived). Until the
  // next successful write of that path settles it, a listing that shows the
  // file at a revision we don't recognise is treated as our own lost write,
  // not another device — see file header (4).
  const uncertain = new Set<string>();

  function track(path: string, text: string, rev: string | undefined): void {
    const value = rev ?? "";
    tracked.set(path, { hash: hashText(text), rev: value });
    rememberRev(path, value);
    uncertain.delete(path);
  }

  log.info(`${options.id}: directory adapter created`);

  // Read the markdown files (or the encrypted blob) into the serialized
  // snapshot text, and refresh `tracked` from what's on disk so the next save
  // diffs against the real current state.
  async function readSnapshot(
    entries: readonly FileEntry[],
  ): Promise<string | null> {
    const revisions = currentRevisions(entries);
    const mdPaths = entries.map((e) => e.path).filter(isMarkdownPath);
    if (mdPaths.length > 0) {
      const files = await Promise.all(
        mdPaths.map(async (path) => ({
          path,
          text: (await store.read(path)) ?? "",
        })),
      );
      for (const file of files) {
        track(file.path, file.text, revisions.get(file.path));
      }
      return serialize(filesToSnapshot(files));
    }
    // No markdown yet: fall back to the single-file blob (an encrypted
    // envelope). Returned verbatim so the pipeline can decrypt it.
    if (entries.some((e) => e.path === BLOB_FILE_NAME)) {
      const blob = await store.read(BLOB_FILE_NAME);
      if (blob !== null) {
        track(BLOB_FILE_NAME, blob, revisions.get(BLOB_FILE_NAME));
      }
      return blob;
    }
    return null;
  }

  async function load(): Promise<StoredSnapshot | null> {
    const entries = await store.list();
    // A load re-establishes the baseline from scratch.
    tracked.clear();
    uncertain.clear();
    const text = await readSnapshot(entries);
    if (text === null) return null;
    const revision = aggregateRevision(entries);
    log.info(`${options.id} load: rev=${shortRev(revision)}`);
    return { text, revision };
  }

  // Decide which owned files a save must touch and whether any of them
  // conflicts with the remote. `desired` is the path -> bytes the new snapshot
  // wants on disk (one entry for the blob, or one per note).
  function plan(
    desired: Map<string, string>,
    current: ReadonlyMap<string, string>,
    base: ReadonlyMap<string, string>,
  ): { toWrite: string[]; toRemove: string[]; conflicts: string[] } {
    const toWrite: string[] = [];
    for (const [path, text] of desired) {
      const known = tracked.get(path);
      if (!known || known.hash !== hashText(text)) toWrite.push(path);
    }
    // Only ever remove files we put there: a note another device added while
    // we weren't looking isn't ours to delete.
    const toRemove = [...tracked.keys()].filter((path) => !desired.has(path));

    const conflicts: string[] = [];
    for (const path of [...toWrite, ...toRemove]) {
      if (isOurs(path, current.get(path), base.get(path))) continue;
      conflicts.push(path);
    }
    return { toWrite, toRemove, conflicts };
  }

  // Is the remote revision of `path` one this device is responsible for, or
  // has another device moved it since our baseline?
  function isOurs(
    path: string,
    remoteRev: string | undefined,
    baseRev: string | undefined,
  ): boolean {
    // A file whose last write threw may have committed without us hearing the
    // new rev — its remote state is our own lost write, not a remote edit.
    if (uncertain.has(path)) return true;
    // Nothing on the remote to collide with: removing a file the listing
    // doesn't show (already gone, or our own create still propagating) and
    // recreating a note another device deleted are both safe to proceed with.
    if (remoteRev === undefined) return true;
    // Unchanged since our baseline — the common case.
    if (remoteRev === baseRev) return true;
    // The remote shows a revision we ourselves produced for this path: a
    // listing still catching up to one of our writes.
    if (producedRevs.get(path)?.includes(remoteRev)) return true;
    return false;
  }

  async function writeFiles(
    desired: Map<string, string>,
    toWrite: readonly string[],
  ): Promise<Map<string, string | undefined>> {
    const written = new Map<string, string | undefined>();
    await Promise.all(
      toWrite.map(async (path) => {
        const text = desired.get(path)!;
        try {
          const rev = await store.write(path, text);
          track(path, text, rev);
          written.set(path, rev);
        } catch (err) {
          // Remember the lost ack so the retry recognises its own write
          // rather than raising a phantom conflict on it.
          uncertain.add(path);
          throw err;
        }
      }),
    );
    return written;
  }

  async function save(
    text: string,
    baseRevision?: string,
  ): Promise<StoredSnapshot> {
    const before = await store.list();
    const current = currentRevisions(before);
    const base = parseRevisions(baseRevision);

    const desired = new Map<string, string>();
    if (isEncryptedEnvelope(text)) {
      // Can't express an envelope as markdown — store it whole and drop any
      // markdown files so the two representations can't disagree.
      desired.set(BLOB_FILE_NAME, text);
    } else {
      for (const file of snapshotToFiles(parse(text))) {
        desired.set(file.path, file.text);
      }
    }

    const { toWrite, toRemove, conflicts } = plan(desired, current, base);
    log.info(
      `${options.id} save: write=${toWrite.length} remove=${toRemove.length} conflicts=${conflicts.length} tracked=${tracked.size}`,
    );

    if (baseRevision !== undefined && conflicts.length > 0) {
      // Always captured (no debug toggle): this single line is what a
      // phantom-conflict bug report turns on. It names the exact files that
      // diverged, so a recurrence is self-diagnosing rather than hidden inside
      // a truncated aggregate revision.
      log.warn(`${options.id} save: remote moved on files we're writing`, {
        conflicts,
        remote: conflicts.map((p) => `${p}:${shortRev(current.get(p))}`),
        base: conflicts.map((p) => `${p}:${shortRev(base.get(p))}`),
      });
      const remoteText = await readSnapshot(before);
      throw new ConflictError({
        text: remoteText ?? serialize(parse(null)),
        revision: aggregateRevision(before),
      });
    }

    const written = await writeFiles(desired, toWrite);
    await Promise.all(
      toRemove.map(async (path) => {
        await store.remove(path);
        tracked.delete(path);
        producedRevs.delete(path);
        uncertain.delete(path);
      }),
    );

    // Build the post-save revision from what we know per file: the rev each
    // write returned, or — for files we didn't rewrite — the rev the listing
    // already showed. Only re-list when a write couldn't report its rev (a
    // backend that doesn't echo it), which is the eventually-consistent path
    // the per-file design otherwise avoids.
    const needsRelist = [...written.values()].some((rev) => rev === undefined);
    let revisions: Map<string, string>;
    if (needsRelist) {
      log.warn(
        `${options.id} save: a write returned no revision — re-listing (lag-prone)`,
      );
      revisions = currentRevisions(await store.list());
      // Re-listing is authoritative for what's actually on disk now.
      for (const [path, rev] of revisions) {
        const known = tracked.get(path);
        if (known) known.rev = rev;
      }
    } else {
      revisions = new Map<string, string>();
      for (const path of desired.keys()) {
        const rev = written.has(path) ? written.get(path)! : current.get(path);
        revisions.set(path, rev ?? "");
      }
    }

    const revision = revLines(revisions);
    log.info(`${options.id} save: committed -> rev=${shortRev(revision)}`);
    return { text, revision };
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
