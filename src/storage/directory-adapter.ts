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

import type {
  AdapterCapability,
  StorageAdapter,
  StoredSnapshot,
} from "./adapter.ts";
import { ConflictError } from "./adapter.ts";
import {
  type AttachmentStore,
  bytesToDataUrl,
  dataUrlToBytes,
} from "./attachment-store.ts";
import { isEncryptedEnvelope } from "./crypto.ts";
import type { FileEntry, FileStore } from "./file-store.ts";
import {
  filesToSnapshot,
  noteFileStem,
  snapshotToFiles,
} from "./markdown/codec.ts";
import { parse, serialize } from "./serialize.ts";
import {
  type Attachment,
  mimeForFilename,
  referencedAttachments,
} from "../domain/attachment.ts";
import type { Snapshot } from "../domain/note.ts";
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

// The on-disk path of one of a note's attachment files, relative to the
// attachment store's `attachments/` root: `<note-stem>/<filename>`. The stem
// matches the note's `<stem>.md` so the load path can pair a note with its
// images, and so a title change relocates both together.
function attachmentPath(stem: string, filename: string): string {
  return `${stem}/${filename}`;
}

// The note-stem segment of an attachment path, used to group a listing by note.
function stemOfAttachmentPath(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

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
  attachments?: AttachmentStore,
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

  // Whether this adapter has ever observed an attachment file (on load, or by
  // writing one). Lets a save skip the attachment listing entirely for the
  // common image-free document — see `reconcileAttachments`.
  let attachmentsTouched = false;

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
  // diffs against the real current state. `reuse` carries the bytes of files
  // whose revision the caller already knows are current, so they're taken from
  // memory instead of re-downloaded — the read half of incremental sync.
  async function readSnapshot(
    entries: readonly FileEntry[],
    reuse: ReadonlyMap<string, string> = new Map(),
  ): Promise<string | null> {
    const revisions = currentRevisions(entries);
    const mdPaths = entries.map((e) => e.path).filter(isMarkdownPath);
    if (mdPaths.length > 0) {
      const files = await Promise.all(
        mdPaths.map(async (path) => ({
          path,
          text: reuse.get(path) ?? (await store.read(path)) ?? "",
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

  // Bytes of the notes a `previous` snapshot already holds at a revision the
  // current listing still reports — these don't need re-downloading. Skipped
  // entirely when the previous bytes are an encrypted envelope (single blob,
  // nothing per-file to reuse) or can't be parsed.
  function reusableFiles(
    previous: StoredSnapshot | undefined,
    entries: readonly FileEntry[],
  ): Map<string, string> {
    const reuse = new Map<string, string>();
    if (!previous || isEncryptedEnvelope(previous.text)) return reuse;
    const prevRevs = parseRevisions(previous.revision);
    if (prevRevs.size === 0) return reuse;
    let prevFiles: Map<string, string>;
    try {
      prevFiles = new Map(
        snapshotToFiles(parse(previous.text)).map((f) => [f.path, f.text]),
      );
    } catch {
      return reuse;
    }
    for (const entry of entries) {
      if (!isMarkdownPath(entry.path)) continue;
      const text = prevFiles.get(entry.path);
      if (
        text !== undefined &&
        prevRevs.get(entry.path) === (entry.rev ?? "")
      ) {
        reuse.set(entry.path, text);
      }
    }
    return reuse;
  }

  async function load(
    previous?: StoredSnapshot,
  ): Promise<StoredSnapshot | null> {
    const entries = await store.list();
    // A load re-establishes the baseline from scratch.
    tracked.clear();
    uncertain.clear();
    const reuse = reusableFiles(previous, entries);
    const text = await readSnapshot(entries, reuse);
    if (text === null) return null;
    const revision = aggregateRevision(entries);
    const mdCount = entries.filter((e) => isMarkdownPath(e.path)).length;
    log.info(
      `${options.id} load: rev=${shortRev(revision)} files=${mdCount} reused=${reuse.size} fetched=${mdCount - reuse.size}`,
    );
    // The markdown carries only the image *references*; pull the image bytes
    // back from the `attachments/` tree and re-attach them. Skipped for an
    // encrypted blob (its images ride inside the envelope, not as files).
    const hydrated =
      attachments && !isEncryptedEnvelope(text)
        ? await hydrateAttachments(text, previous)
        : text;
    return { text: hydrated, revision };
  }

  // Read the note images back from the `attachments/` tree into the snapshot's
  // `data:` URLs. Images whose filename the `previous` snapshot already holds
  // are reused from memory rather than re-downloaded — attachments are
  // content-addressed by a unique filename, so a matching name means matching
  // bytes. Only genuinely new files are fetched.
  async function hydrateAttachments(
    text: string,
    previous: StoredSnapshot | undefined,
  ): Promise<string> {
    let entries: { path: string }[];
    try {
      entries = await attachments!.list();
    } catch (err) {
      log.warn(`${options.id} load: listing attachments failed`, err);
      return text;
    }
    if (entries.length === 0) return text;
    attachmentsTouched = true;

    const snapshot = parse(text);
    // Index this note set's attachment files by note stem.
    const byStem = new Map<string, string[]>();
    for (const entry of entries) {
      const stem = stemOfAttachmentPath(entry.path);
      if (!stem) continue;
      const list = byStem.get(stem) ?? [];
      list.push(entry.path);
      byStem.set(stem, list);
    }

    // Prior `data:` URLs keyed by filename, so an unchanged image is reused.
    const cached = previousAttachmentData(previous);

    let fetched = 0;
    for (const note of snapshot.notes) {
      const stem = noteFileStem(note);
      const paths = byStem.get(stem);
      if (!paths || paths.length === 0) continue;
      const out: Attachment[] = [];
      for (const path of paths) {
        const filename = path.slice(stem.length + 1);
        const reused = cached.get(filename);
        if (reused) {
          out.push(reused);
          continue;
        }
        const bytes = await attachments!.read(path);
        if (!bytes) continue;
        const mime = mimeForFilename(filename);
        out.push({ filename, mime, data: bytesToDataUrl(mime, bytes) });
        fetched += 1;
      }
      if (out.length > 0) note.attachments = out;
    }
    if (fetched > 0) {
      log.info(`${options.id} load: fetched ${fetched} attachment file(s)`);
    }
    return serialize(snapshot);
  }

  // The `data:` URLs a `previous` snapshot already holds, keyed by attachment
  // filename, so a load can reuse them instead of re-downloading. Tolerates an
  // encrypted or unparseable previous by returning an empty map.
  function previousAttachmentData(
    previous: StoredSnapshot | undefined,
  ): Map<string, Attachment> {
    const map = new Map<string, Attachment>();
    if (!previous || isEncryptedEnvelope(previous.text)) return map;
    let snapshot: Snapshot;
    try {
      snapshot = parse(previous.text);
    } catch {
      return map;
    }
    for (const note of snapshot.notes) {
      for (const a of note.attachments ?? []) {
        if (!map.has(a.filename)) map.set(a.filename, a);
      }
    }
    return map;
  }

  // The image files a snapshot wants on disk: one per *referenced* attachment,
  // keyed by its `<stem>/<filename>` path. Unreferenced attachments (the user
  // deleted the image's line) are dropped so their file is reconciled away.
  function desiredAttachments(snapshot: Snapshot): Map<string, Attachment> {
    const desired = new Map<string, Attachment>();
    for (const note of snapshot.notes) {
      const stem = noteFileStem(note);
      for (const a of referencedAttachments(note.body, note.attachments)) {
        desired.set(attachmentPath(stem, a.filename), a);
      }
    }
    return desired;
  }

  // Add any new image file and remove orphans (a deleted image, or an old-stem
  // file left behind by a rename). Best-effort write/remove with errors
  // propagated so the sync engine retries — markdown writes are idempotent, so
  // a retried save re-runs cleanly.
  async function reconcileAttachments(snapshot: Snapshot): Promise<void> {
    const desired = desiredAttachments(snapshot);
    // The overwhelmingly common case is a note set with no images at all: skip
    // the listing round-trip entirely until this adapter has actually seen an
    // attachment (on load or an earlier save), so an image-free document never
    // pays for the feature.
    if (desired.size === 0 && !attachmentsTouched) return;
    if (desired.size > 0) attachmentsTouched = true;
    let current: { path: string }[];
    try {
      current = await attachments!.list();
    } catch (err) {
      log.warn(`${options.id} save: listing attachments failed`, err);
      current = [];
    }
    const currentPaths = new Set(current.map((e) => e.path));
    if (currentPaths.size > 0) attachmentsTouched = true;

    const toWrite: [string, Attachment][] = [];
    for (const [path, attachment] of desired) {
      if (!currentPaths.has(path)) toWrite.push([path, attachment]);
    }
    const toRemove = [...currentPaths].filter((p) => !desired.has(p));
    if (toWrite.length === 0 && toRemove.length === 0) return;
    log.info(
      `${options.id} save: attachments write=${toWrite.length} remove=${toRemove.length}`,
    );

    await Promise.all(
      toWrite.map(async ([path, attachment]) => {
        const decoded = dataUrlToBytes(attachment.data);
        if (!decoded) return; // remote/non-data href — nothing to externalise
        await attachments!.write(path, decoded.bytes, decoded.mime);
      }),
    );
    await Promise.all(toRemove.map((path) => attachments!.remove(path)));
  }

  // Remove every externalised attachment file. Run when the document is
  // converted to an encrypted blob: the images now ride inside the envelope, so
  // the plaintext copies under `attachments/` are both redundant and a leak.
  // Best-effort listing — a failure leaves the files for a later pass rather
  // than failing the (already committed) document write.
  async function clearAttachments(): Promise<void> {
    let current: { path: string }[];
    try {
      current = await attachments!.list();
    } catch (err) {
      log.warn(`${options.id} save: listing attachments to clear failed`, err);
      return;
    }
    if (current.length === 0) return;
    log.info(
      `${options.id} save: clearing ${current.length} attachment file(s) (encrypting)`,
    );
    await Promise.all(current.map((entry) => attachments!.remove(entry.path)));
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

    // A format conversion (plaintext markdown <-> encrypted blob) rewrites the
    // whole document into the other representation, superseding the previous
    // one wholesale: the encrypted blob holds every note, so every markdown
    // file is stale; decrypted markdown supersedes the blob. Remove the
    // superseded representation unconditionally — including files this adapter
    // instance never tracked, because the load before an encryption toggle can
    // be served from the offline cache and a backend / namespace swap rebuilds
    // the adapter with an empty `tracked`. Without this, enabling encryption
    // leaves the plaintext `.md` sitting beside the new `notes.json` (and the
    // next load reads the markdown back, so encryption silently has no effect
    // at rest), and disabling it strands the ciphertext beside the markdown.
    const writingBlob = desired.has(BLOB_FILE_NAME);
    const superseded = before
      .map((e) => e.path)
      .filter(
        (path) =>
          isOwnedPath(path) &&
          !desired.has(path) &&
          (writingBlob ? isMarkdownPath(path) : path === BLOB_FILE_NAME),
      );

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
    // The superseded-format files are removed alongside the tracked ones; the
    // union dedupes the overlap (a tracked file that is also a stale format).
    const removals = [...new Set([...toRemove, ...superseded])];
    await Promise.all(
      removals.map(async (path) => {
        await store.remove(path);
        tracked.delete(path);
        producedRevs.delete(path);
        uncertain.delete(path);
      }),
    );

    // Keep the externalised images in step with the representation just
    // written. Plaintext markdown carries only image *references*, so the bytes
    // live beside it under `attachments/`; an encrypted blob folds the images
    // into the envelope. On the plaintext→encrypted conversion (signalled by
    // markdown files being superseded) the plaintext copies must be cleared —
    // both because they're now redundant and because leaving them is a
    // plaintext leak that would defeat enabling encryption. A steady-state
    // encrypted save supersedes nothing, so it skips the attachment listing
    // entirely rather than paying for it on every keystroke.
    if (attachments) {
      if (isEncryptedEnvelope(text)) {
        if (superseded.length > 0) await clearAttachments();
      } else {
        await reconcileAttachments(parse(text));
      }
    }

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

  // Advertise image attachments only when an attachment store is wired, so the
  // editor enables paste / drop on the file backends and leaves it off for the
  // local (browser) backend that has nowhere to put a file.
  const capabilities = new Set<AdapterCapability>();
  if (attachments) capabilities.add("attachments");

  return {
    id: options.id,
    label: options.label,
    saveDebounceMs: options.saveDebounceMs,
    capabilities,
    load,
    save,
  };
}
