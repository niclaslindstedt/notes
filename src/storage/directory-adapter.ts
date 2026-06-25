// Wraps any `FileStore` into a `StorageAdapter`, storing the document as a
// folder of individual files (one per note). This is the single place the
// file-based backends — local folder, Dropbox, Google Drive — share, so the
// representation, conflict detection, and incremental sync are implemented once
// rather than per backend.
//
// Three on-disk representations, picked by whether a session passphrase is held
// (`crypto.passwordRef.current`):
//
//   - **Plaintext** (no passphrase): one `<slug>-<id>.md` per note, with each
//     note's attachments externalised as real files under the attachment
//     store's `<note-stem>/<filename>` tree. This is the historical format and
//     its logic below is unchanged.
//   - **Encrypted** (passphrase held): one opaque `<ref>.enc` file per note
//     (the note JSON sealed with the session content key) and one opaque
//     `<ref>` blob per attachment in the attachment store. The opaque names are
//     a keyed HMAC of the note id (+ filename), so nothing about the title,
//     filename, extension, or grouping leaks on disk. Each note + each
//     attachment is its own encrypted blob — never folded together — so a note
//     can be read without downloading every other note's attachments.
//   - **Legacy blob** (`notes.json`): the old whole-document AES-GCM envelope.
//     Read-only — on the next save it is superseded by the per-file form.
//
// Bytes in, bytes out: `save` is always handed the plaintext serialized
// snapshot and `load` always returns it, so the sync engine and the offline
// cache (which re-seals the plaintext into a single envelope so localStorage
// stays ciphertext) are unchanged. The crypto lives here because this is the
// only layer that already owns per-file writes and the representation switch.
//
// ## Atomicity — no data loss across a representation switch
//
// Plaintext and encrypted files live at *different, deterministic* paths, so a
// switch (enable / disable encryption) is write-new → verify-by-readback →
// delete-old: the new representation is written and re-read to confirm it
// committed and decrypts, and only then is the superseded representation
// removed. A crash between the two leaves both on disk; the next pass re-derives
// the same paths and finishes idempotently. No interruption can lose data.
//
// ## Per-file sync, not whole-document sync
//
// Each note is its own file with its own revision, treated independently so a
// 500-note folder stays usable and a device never collides with itself:
//
//   1. **Only changed notes are written** (hash of the *plaintext* note source,
//      so a re-encryption with a fresh IV doesn't look like a change).
//   2. **Conflicts are scoped to the notes being written.**
//   3. **We never clobber notes we didn't author.**
//   4. **Our own lag and lost acks are tolerated per file.**

import type {
  AdapterCapability,
  NoteEncStatus,
  StorageAdapter,
  StoredSnapshot,
} from "./adapter.ts";
import { ConflictError } from "./adapter.ts";
import type { AttachmentStore } from "./attachment-store.ts";
import {
  attachmentPath,
  createAttachmentReconciler,
  isPlaintextAttachmentPath,
} from "./attachment-reconcile.ts";
import {
  type SessionKeys,
  decryptEnvelope,
  isEncryptedEnvelope,
} from "./crypto.ts";
import { createCryptoSession } from "./crypto-session.ts";
import { encJsonToNote, noteToEncJson } from "./enc-note-codec.ts";
import { createFolderRegistry, injectFolders } from "./folder-registry.ts";
import { createMigrationConverters } from "./migration-converters.ts";
import { openBytes, openString, sealString } from "./crypto-binary.ts";
import {
  type IndexEntry,
  indexEntryToNote,
  noteToIndexEntry,
  parseIndex,
  serializeIndex,
} from "./note-index.ts";
import type { FileEntry, FileStore } from "./file-store.ts";
import {
  filesToSnapshot,
  noteFilePath,
  noteFileStem,
  snapshotToFiles,
} from "./markdown/codec.ts";
import { parse, serialize } from "./serialize.ts";
import { mimeForFilename } from "../domain/attachment.ts";
import type { Note, Snapshot } from "../domain/note.ts";
import { createLogger } from "../dev/logger.ts";

const log = createLogger("sync");

// Shorten an aggregate revision for a log line.
function shortRev(rev: string | undefined): string {
  if (rev === undefined) return "∅";
  if (rev.length <= 48) return rev;
  return `${rev.slice(0, 28)}…${rev.slice(-16)}`;
}

// Single-file location for the legacy whole-document AES-GCM envelope.
export const BLOB_FILE_NAME = "notes.json";
// The KDF-salts file is owned by the crypto session (it derives the keys from
// it); re-exported here so the encryption representation's path set stays
// importable from this module.
export { KEY_PARAMS_FILE } from "./crypto-session.ts";
// The folder registry sidecar is owned by the folder registry (it reads and
// writes it); re-exported here so the encryption representation's path set stays
// importable from this module.
export { FOLDERS_FILE_NAME } from "./folder-registry.ts";
// Suffix of an encrypted per-note file. The stem is the opaque keyed-HMAC ref.
const ENC_SUFFIX = ".enc";
// The encrypted note-index sidecar (see ./note-index.ts): one sealed file
// listing every note's metadata + a preview snippet so an unlock renders the
// whole list from a single read + decrypt, deferring each body until its note
// is opened. Deliberately NOT given the `.enc` suffix so it is never mistaken
// for a per-note file, and metadata (not a note) so a representation switch
// leaves it alone — the encrypted→plaintext save removes it explicitly.
export const INDEX_FILE_NAME = ".index.bin";
// Tracked-source sentinel for a deferred note (body not loaded): it marks the
// note's `.enc` as present so a delete is detected, while the save planner skips
// writing it (its body isn't in memory to seal). A note that is actually edited
// is loaded first (its body fetched), so it never reaches save still deferred.
// Only ever hashed in-memory by `track()` and compared against a real note's
// `noteToEncJson()` output (always a JSON object string starting with `{"id":`),
// never persisted — so the only invariant is that it can never equal that
// output. A printable, non-JSON marker satisfies that; it stays plain ASCII so
// the file remains textual to git (a single NUL byte would make git read the
// whole file as binary, breaking `git diff`/`blame` and the review UI).
const DEFERRED_SOURCE = "<<deferred-note: body not loaded>>";

// The note-index sidecar read/write is retried so a transient cloud failure (a
// cold-start 429 from the load's request burst, a dropped fetch on a flaky
// mobile link — Safari reports both as a bare `TypeError: Load failed`) isn't
// mistaken for "the file isn't there", which would force the load to decrypt
// every note up front instead of rendering from the index. A few short,
// backing-off attempts comfortably outlast a brief rate-limit window without
// stalling a genuinely absent index for long. (The folder registry sidecar
// applies the same retry in folder-registry.ts.)
const SIDECAR_RETRY_ATTEMPTS = 3;
const SIDECAR_RETRY_BACKOFF_MS = 250;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// How many encrypted note files to read + decrypt at once during an unlock /
// encrypted load. Sequential decryption made a cold load O(notes) network
// round-trips on a cloud backend (tens of seconds for a 500-note vault); a
// bounded pool overlaps the reads and the (off-main-thread) AES work while
// staying well under the cloud APIs' rate limits — unlike an unbounded
// `Promise.all`, which would fire 500 simultaneous fetches and trip throttling.
const ENC_LOAD_CONCURRENCY = 8;

// Map over `items` running at most `limit` jobs at once, preserving input order
// in the result. Used to parallelise the encrypted load's per-note decrypt
// without bursting the backend.
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  }
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, items.length); i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// What the encrypted load reports as it unseals each per-file note: the note's
// title plus a running count, so the unlock gate can name the note that just
// decrypted and show how far through the run it is. With the load now decrypting
// in a bounded pool, the count is completion order, not on-disk order.
export type DecryptNoteInfo = {
  title: string;
  index: number;
  total: number;
};
export type DecryptNoteReporter = (info: DecryptNoteInfo) => void;

// The session passphrase, by reference so it can change at runtime (unlock /
// enable / disable) without rebuilding the adapter. `onDecryptNote` is an
// optional reporter ref the encrypted load drains once per note as it decrypts
// them (in a bounded pool) — the unlock flow points it at the gate's status line
// while it unlocks, and clears it afterward, so it costs nothing the rest of the time.
export type DirectoryCrypto = {
  passwordRef: { readonly current: string | null };
  onDecryptNote?: { readonly current: DecryptNoteReporter | null };
};

function isMarkdownPath(path: string): boolean {
  return path.endsWith(".md");
}

function isEncNotePath(path: string): boolean {
  return path.endsWith(ENC_SUFFIX);
}

// Paths this adapter owns inside the notes folder: a plaintext `*.md` note, an
// encrypted `*.enc` note, or the legacy blob. The key-params file is metadata,
// not a note — owned in the sense that it's left alone, never read as a note
// nor removed on a representation switch, so it is handled separately.
function isOwnedPath(path: string): boolean {
  return isMarkdownPath(path) || isEncNotePath(path) || path === BLOB_FILE_NAME;
}

// A cheap, stable content hash (djb2) used only to tell "did this note's
// plaintext source change since we last wrote it?" — never persisted.
function hashText(text: string): number {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) {
    h = (Math.imul(h, 33) + text.charCodeAt(i)) | 0;
  }
  return h;
}

function aggregateRevision(entries: readonly FileEntry[]): string {
  return revLines(currentRevisions(entries));
}

// A fingerprint of the *entire* on-disk listing — every path's revision, not
// just the note files `aggregateRevision` covers. Used as the load memo's key
// so any change at all (a note, `folders.json`, the key params) busts it, while
// the snapshot's own `revision` keeps its owned-only meaning for save/conflict.
function listingFingerprint(entries: readonly FileEntry[]): string {
  return entries
    .map((e) => `${e.path}:${e.rev ?? ""}`)
    .sort()
    .join("\n");
}

function currentRevisions(entries: readonly FileEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    if (isOwnedPath(entry.path)) map.set(entry.path, entry.rev ?? "");
  }
  return map;
}

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

// One desired file: the bytes to write (`stored`) and the plaintext source to
// hash for change detection (`source`). In plaintext mode `stored` is the source
// itself. In encrypted mode `stored` is filled lazily via `seal` — only for the
// files `plan` actually decides to write — so a single edit in a 500-note vault
// re-encrypts one note, not all of them (sealing is gzip + AES-GCM + base64 per
// note, far too costly to spend on every unchanged note each save). `source` is
// the stable plaintext, hashed for change detection (so a fresh-IV re-encryption
// of an unchanged note never looks like a change) and compared on verify.
type DesiredFile = {
  stored?: string;
  source: string;
  seal?: () => Promise<string>;
  // A deferred note's `.enc`: present in `desired` so it is never removed as an
  // orphan, but never written (its body isn't loaded). The planner skips it.
  skip?: boolean;
};

type Tracked = {
  hash: number;
  rev: string;
};

export function createDirectoryAdapter(
  store: FileStore,
  options: DirectoryAdapterOptions,
  attachments?: AttachmentStore,
  crypto?: DirectoryCrypto,
): StorageAdapter {
  const tracked = new Map<string, Tracked>();
  const producedRevs = new Map<string, string[]>();
  const MAX_TRACKED_REVS = 6;
  function rememberRev(path: string, rev: string): void {
    const list = producedRevs.get(path) ?? [];
    if (list[list.length - 1] === rev) return;
    list.push(rev);
    if (list.length > MAX_TRACKED_REVS) list.shift();
    producedRevs.set(path, list);
  }

  const uncertain = new Set<string>();

  // The attachment-externalisation concern: reconciling each note's pasted
  // attachments against their on-disk files (plaintext `<stem>/<filename>` or
  // opaque encrypted blobs) on every load and save. Owns the
  // `attachmentsTouched` session flag; the load path marks it via `markTouched`
  // when it spots attachment metadata off the encrypted note JSON, and the
  // reconcile passes read it to skip the listing round-trip when no attachment
  // has ever been seen. The `attBlobPath` ref deriver is handed to the
  // encrypted reconcile per call so the module stays independent of the crypto
  // session.
  const attachmentReconciler = createAttachmentReconciler({
    attachments,
    id: options.id,
  });

  // The folder-registry concern: the `folders.json` sidecar (display names +
  // empty folders) and the in-memory state derived from it. `readFolders` /
  // `persistFolders` move the sidecar's bytes; `plaintextNotePath` resolves a
  // note's folder-aware `.md` path against the last-known registry; the load
  // gates its memo on `readOk()` and the save records its registry via
  // `rememberFolders`. (`injectFolders` is the pure fold-into-snapshot helper,
  // imported as a module function since it carries no state.)
  const folderRegistry = createFolderRegistry({ store, id: options.id });
  const { readFolders, persistFolders, plaintextNotePath } = folderRegistry;

  // Per-note upload progress: the ids of notes whose file is being written to
  // the backend right now. `save` marks a note's id while its `store.write` is
  // in flight and clears it when the write settles, so the UI can spin a glyph
  // next to exactly the notes currently uploading. Listeners get the full set
  // on every change (and once on subscribe). Empty whenever nothing is in
  // flight, so a slow cloud write shows the spinner and a fast local one barely
  // flickers.
  const uploadingIds = new Set<string>();
  const uploadListeners = new Set<(ids: ReadonlySet<string>) => void>();
  function emitUploads(): void {
    const frozen: ReadonlySet<string> = new Set(uploadingIds);
    for (const listener of uploadListeners) listener(frozen);
  }
  function setUploading(ids: readonly string[], active: boolean): void {
    let changed = false;
    for (const id of ids) {
      if (active && !uploadingIds.has(id)) {
        uploadingIds.add(id);
        changed = true;
      } else if (!active && uploadingIds.delete(id)) {
        changed = true;
      }
    }
    if (changed) emitUploads();
  }
  function watchUploads(
    listener: (ids: ReadonlySet<string>) => void,
  ): () => void {
    uploadListeners.add(listener);
    listener(new Set(uploadingIds));
    return () => {
      uploadListeners.delete(listener);
    };
  }

  // Per-note at-rest encryption status from the last encrypted load (the
  // `NoteEncStatus` type is shared with the adapter contract): a note is
  // "encrypted" once its `.enc` file exists and none of its attachments linger
  // as a plaintext file; "pending" while a plaintext remnant remains (an
  // in-progress migration). Drives the green lock in the UI.
  let encStatus = new Map<string, NoteEncStatus>();

  // The snapshot the last load produced, keyed by the full listing fingerprint.
  // When a fresh `store.list()` proves the on-disk state is byte-identical, the
  // load returns this without re-reading or re-decrypting anything — collapsing
  // the unlock's two back-to-back loads (gate verifies, then the adapter swap
  // reloads) into one decrypt, and making an idle live-pull cost a single
  // listing. Listing is always re-run, so this never serves data staler than the
  // backend. It is plaintext-safe (valid across plaintext loads) but must not
  // survive a passphrase change — the crypto session clears it via
  // `onKeysInvalidated` on every lock / unlock / switch.
  let lastLoad: { key: string; snapshot: StoredSnapshot } | null = null;

  // Per-session encryption state — derived keys, memoised opaque refs, and the
  // decrypted-note cache, all keyed off the active passphrase. `ensureKeys`,
  // `cachedRef`, and `encNoteCache` are used unchanged below; the session is the
  // single source of truth that keeps `save`, `attBlobPath`, and `migrateNote`
  // deriving refs from the same keys.
  const { ensureKeys, cachedRef, encNoteCache } = createCryptoSession({
    store,
    passwordRef: crypto?.passwordRef,
    onKeysInvalidated: () => {
      lastLoad = null;
    },
  });

  function track(path: string, source: string, rev: string | undefined): void {
    const value = rev ?? "";
    tracked.set(path, { hash: hashText(source), rev: value });
    rememberRev(path, value);
    uncertain.delete(path);
  }

  log.info(`${options.id}: directory adapter created`);

  async function encNotePath(
    keys: SessionKeys,
    noteId: string,
  ): Promise<string> {
    return `${await cachedRef(keys, "note", noteId)}${ENC_SUFFIX}`;
  }

  async function attBlobPath(
    keys: SessionKeys,
    noteId: string,
    filename: string,
  ): Promise<string> {
    return cachedRef(keys, "att", `${noteId} ${filename}`);
  }

  // -- Encrypted note index --------------------------------------------------

  // Read + decrypt the index sidecar, tolerating absence or corruption by
  // yielding null — the load then falls back to decrypting the per-note files
  // (the authoritative path), so a missing or stale index only costs work.
  async function readIndexEntries(
    keys: SessionKeys,
  ): Promise<IndexEntry[] | null> {
    // Retry the read the same way the folder sidecar does: a single dropped
    // fetch on a flaky link must not be mistaken for "no index", which would
    // force the whole vault to be decrypted note-by-note on unlock.
    let text: string | null = null;
    let read = false;
    for (let attempt = 0; attempt < SIDECAR_RETRY_ATTEMPTS; attempt += 1) {
      try {
        text = await store.read(INDEX_FILE_NAME);
        read = true;
        break;
      } catch (err) {
        log.warn(
          `${options.id} index: read failed (attempt ${attempt + 1}/${SIDECAR_RETRY_ATTEMPTS})`,
          err,
        );
        if (attempt < SIDECAR_RETRY_ATTEMPTS - 1) {
          await sleep(SIDECAR_RETRY_BACKOFF_MS * (attempt + 1));
        }
      }
    }
    if (!read) {
      log.warn(`${options.id} index: read failed — per-note fallback`);
      return null;
    }
    if (text === null) return null;
    try {
      const opened = await openString(keys.contentKey, text);
      return parseIndex(new TextDecoder().decode(opened.bytes));
    } catch (err) {
      log.warn(`${options.id} index: open failed — per-note fallback`, err);
      return null;
    }
  }

  // Seal + write the index. Best-effort: a failure is logged and swallowed so a
  // flaky index write never fails the save it rides on — the per-note files (the
  // source of truth) are already committed, and the next load reconciles.
  async function sealWriteIndex(
    keys: SessionKeys,
    entries: readonly IndexEntry[],
  ): Promise<void> {
    try {
      const sealed = await sealString(keys.contentKey, serializeIndex(entries));
      // Retry like the read: a flaky link that drops this write would leave the
      // index stale/absent, so the *next* unlock decrypts every note. The
      // per-note files are already committed, so a write that fails every
      // attempt is still non-fatal — the next save (or self-heal) re-seals it.
      for (let attempt = 0; attempt < SIDECAR_RETRY_ATTEMPTS; attempt += 1) {
        try {
          await store.write(INDEX_FILE_NAME, sealed);
          return;
        } catch (err) {
          if (attempt === SIDECAR_RETRY_ATTEMPTS - 1) throw err;
          await sleep(SIDECAR_RETRY_BACKOFF_MS * (attempt + 1));
        }
      }
    } catch (err) {
      log.warn(`${options.id} index: write failed (non-fatal)`, err);
    }
  }

  // -- Plaintext load --------------------------------------------------------

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
    if (entries.some((e) => e.path === BLOB_FILE_NAME)) {
      const blob = await store.read(BLOB_FILE_NAME);
      if (blob !== null) {
        track(BLOB_FILE_NAME, blob, revisions.get(BLOB_FILE_NAME));
      }
      return blob;
    }
    return null;
  }

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

  // -- Encrypted load --------------------------------------------------------

  async function readEncryptedSnapshot(
    keys: SessionKeys,
    entries: readonly FileEntry[],
  ): Promise<string | null> {
    const revisions = currentRevisions(entries);
    const encPaths = entries.map((e) => e.path).filter(isEncNotePath);
    const mdPaths = entries.map((e) => e.path).filter(isMarkdownPath);
    const status = new Map<string, NoteEncStatus>();

    // No per-file notes yet: a legacy whole-document envelope is decrypted with
    // the passphrase so the document survives; the next save rewrites it
    // per-file. Otherwise nothing is stored.
    if (encPaths.length === 0 && mdPaths.length === 0) {
      if (entries.some((e) => e.path === BLOB_FILE_NAME)) {
        const blob = await store.read(BLOB_FILE_NAME);
        const password = crypto?.passwordRef.current;
        if (blob && password && isEncryptedEnvelope(blob)) {
          track(BLOB_FILE_NAME, blob, revisions.get(BLOB_FILE_NAME));
          return decryptEnvelope(blob, password);
        }
        return blob;
      }
      encStatus = status;
      return null;
    }

    const notes: Note[] = [];
    const seen = new Set<string>();

    // The index is the fast path: one read + decrypt yields every note's
    // metadata + preview, so the list renders without touching the per-note
    // files. Map each index row to the note's on-disk path so it can be matched
    // against the listing by revision. (`encNotePath` is a memoised HMAC.)
    const indexEntries = (await readIndexEntries(keys)) ?? [];
    const indexByPath = new Map<string, IndexEntry>(
      await Promise.all(
        indexEntries.map(
          async (entry) => [await encNotePath(keys, entry.id), entry] as const,
        ),
      ),
    );

    // Partition the note files: those an up-to-date index row covers are served
    // **deferred** (body left unloaded, fetched on open); the rest — files the
    // index doesn't cover or whose revision has moved past the index (a stale
    // index, or a note another device just changed) — are decrypted in full as
    // the authoritative fallback. A note whose body we already hold in
    // `encNoteCache` at the current revision is decrypted-from-cache (no I/O),
    // so opened/warmed bodies stay loaded across reloads.
    const deferredPaths: [string, IndexEntry][] = [];
    const decryptPaths: string[] = [];
    // Whether the index on disk fully covers the current note files — a fresh
    // row for every one and no orphan rows for deleted notes. A single miss
    // means it's stale/incomplete; the load self-heals it below so the next
    // unlock is index-fast again rather than decrypting the same notes forever.
    let indexCoversAll = indexEntries.length === encPaths.length;
    for (const path of encPaths) {
      const rev = revisions.get(path) ?? "";
      const entry = indexByPath.get(path);
      const indexFresh =
        entry !== undefined && entry.rev !== undefined && entry.rev === rev;
      if (!indexFresh) indexCoversAll = false;
      const cached = encNoteCache.get(path);
      if (cached && cached.rev === rev) {
        decryptPaths.push(path);
        continue;
      }
      if (indexFresh) {
        deferredPaths.push([path, entry]);
      } else {
        decryptPaths.push(path);
      }
    }

    // Deferred notes: pure metadata, no I/O. Track each so a later delete of an
    // unopened note is detected (tracked-but-not-desired ⇒ remove), while the
    // save planner skips writing it.
    for (const [path, entry] of deferredPaths) {
      const note = indexEntryToNote(entry);
      track(path, DEFERRED_SOURCE, revisions.get(path));
      notes.push(note);
      seen.add(note.id);
      status.set(note.id, "encrypted");
    }

    // The fallback set, unsealed with a bounded pool. On a cloud backend each
    // read is a network fetch, so overlapping them turns a cold load from
    // O(notes) sequential round-trips into a handful of waves. With a complete,
    // fresh index this set is empty (or just cache hits), so a normal unlock
    // decrypts nothing up front. The per-note reporter drives the unlock gate's
    // status line; a note's title lives inside its ciphertext, so it fires as
    // each finishes with a completion counter against the fallback total.
    const reportNote = crypto?.onDecryptNote?.current;
    let decrypted = 0;
    const opened = await mapWithConcurrency(
      decryptPaths,
      ENC_LOAD_CONCURRENCY,
      async (path) => {
        const rev = revisions.get(path) ?? "";
        const cached = encNoteCache.get(path);
        let json: string;
        if (cached && cached.rev === rev) {
          json = cached.json;
        } else {
          const text = await store.read(path);
          if (text === null) return null;
          const blob = await openString(keys.contentKey, text);
          json = new TextDecoder().decode(blob.bytes);
          encNoteCache.set(path, { rev, json });
        }
        const note = encJsonToNote(json);
        if (note) {
          decrypted += 1;
          reportNote?.({
            title: note.title,
            index: decrypted,
            total: decryptPaths.length,
          });
        }
        return { path, json, note };
      },
    );
    // Forget cached notes whose file is gone so the map can't grow across a long
    // session of deletes.
    const encPathSet = new Set(encPaths);
    for (const path of [...encNoteCache.keys()]) {
      if (!encPathSet.has(path)) encNoteCache.delete(path);
    }
    for (const entry of opened) {
      if (!entry) continue;
      track(entry.path, entry.json, revisions.get(entry.path));
      if (entry.note && !seen.has(entry.note.id)) {
        notes.push(entry.note);
        seen.add(entry.note.id);
        status.set(entry.note.id, "encrypted");
      }
    }
    // Plaintext remnants from an in-progress migration: merge any note not yet
    // present from the encrypted set, so the document stays complete (and the
    // migration is resumable) mid-flight.
    if (mdPaths.length > 0) {
      const files = await Promise.all(
        mdPaths.map(async (path) => ({
          path,
          text: (await store.read(path)) ?? "",
        })),
      );
      for (const f of files) track(f.path, f.text, revisions.get(f.path));
      for (const note of filesToSnapshot(files).notes) {
        if (!seen.has(note.id)) {
          notes.push(note);
          status.set(note.id, "pending");
        }
      }
    }

    // Attachments are read on demand, not here. A fully-migrated vault (no
    // plaintext note remnants) already carries each encrypted note's attachment
    // metadata inside its own note JSON, so the only thing a fresh attachment
    // listing would add is spotting a plaintext attachment stranded by an
    // interrupted migration — a transient state the next save reconciles. So we
    // walk the listing only while plaintext note remnants remain; otherwise we
    // skip it (a network round-trip on a cloud backend) and keep orphan-blob
    // cleanup armed for the next save off the metadata already in hand.
    if (mdPaths.length > 0) {
      await attachmentReconciler.attachEncryptedMetadata(notes, status);
    } else if (notes.some((n) => n.attachments?.length)) {
      attachmentReconciler.markTouched();
    }

    // Self-heal a missing or stale index. If this load couldn't render entirely
    // from the index — no index at all (the first load after enabling
    // encryption, before any save has run), or one another device left
    // stale/incomplete (missing rows, moved revisions, or orphan rows for
    // deleted notes) — some notes fell to the per-note fallback above, so we now
    // hold the full authoritative metadata. Rewrite the index from it so the
    // *next* unlock takes the fast path instead of decrypting the same notes
    // again. Best-effort; skipped when the index already matched (nothing to do)
    // and while a migration is still in flight (plaintext remnants), since the
    // picture is incomplete.
    if (!indexCoversAll && mdPaths.length === 0 && notes.length > 0) {
      const entries = await Promise.all(
        notes.map(async (note) =>
          noteToIndexEntry(
            note,
            revisions.get(await encNotePath(keys, note.id)),
          ),
        ),
      );
      await sealWriteIndex(keys, entries);
    }

    encStatus = status;
    return serialize({ notes });
  }

  async function load(
    previous?: StoredSnapshot,
  ): Promise<StoredSnapshot | null> {
    const keys = await ensureKeys();
    const entries = await store.list();
    // The listing is always fresh, so the fingerprint reflects the backend's
    // current state. If it's byte-identical to the last load's, nothing on disk
    // moved — return the snapshot we already built without re-reading or
    // re-decrypting a single file. `tracked` and the folder registry already
    // describe this exact state from that load, so they're left intact.
    const fingerprint = listingFingerprint(entries);
    if (lastLoad && lastLoad.key === fingerprint) {
      log.info(
        `${options.id} load: unchanged (rev=${shortRev(aggregateRevision(entries))}) — reusing decrypted snapshot`,
      );
      return lastLoad.snapshot;
    }
    tracked.clear();
    uncertain.clear();
    const revision = aggregateRevision(entries);
    // Folder registry sidecar — read alongside the notes so an empty folder (or
    // the display names the note files don't carry) survives. A namespace whose
    // only content is empty folders still loads as a real, non-null document.
    const folders = await readFolders();
    const emptyWithFolders = (): StoredSnapshot | null =>
      folders.length === 0
        ? null
        : { text: injectFolders(serialize({ notes: [] }), folders), revision };

    if (keys) {
      const text = await readEncryptedSnapshot(keys, entries);
      if (text === null) return emptyWithFolders();
      log.info(`${options.id} load (encrypted): rev=${shortRev(revision)}`);
      const result = { text: injectFolders(text, folders), revision };
      // Only memoize when the folder sidecar was actually read — otherwise a
      // transient folders-read failure would cache the folderless result and
      // serve it until the adapter is rebuilt (the bug this guards).
      if (folderRegistry.readOk())
        lastLoad = { key: fingerprint, snapshot: result };
      return result;
    }

    const reuse = reusableFiles(previous, entries);
    const text = await readSnapshot(entries, reuse);
    if (text === null) return emptyWithFolders();
    const mdCount = entries.filter((e) => isMarkdownPath(e.path)).length;
    log.info(
      `${options.id} load: rev=${shortRev(revision)} files=${mdCount} reused=${reuse.size} fetched=${mdCount - reuse.size}`,
    );
    const hydrated =
      attachments && !isEncryptedEnvelope(text)
        ? await attachmentReconciler.hydratePlaintext(text)
        : text;
    const result = { text: injectFolders(hydrated, folders), revision };
    if (folderRegistry.readOk())
      lastLoad = { key: fingerprint, snapshot: result };
    return result;
  }

  // -- Shared save machinery -------------------------------------------------

  function plan(
    desired: Map<string, DesiredFile>,
    current: ReadonlyMap<string, string>,
    base: ReadonlyMap<string, string>,
  ): { toWrite: string[]; toRemove: string[]; conflicts: string[] } {
    const toWrite: string[] = [];
    for (const [path, d] of desired) {
      // A deferred note's `.enc` is preserved as-is — never written (its body
      // isn't loaded to seal) and, being in `desired`, never removed.
      if (d.skip) continue;
      const known = tracked.get(path);
      if (!known || known.hash !== hashText(d.source)) toWrite.push(path);
    }
    const toRemove = [...tracked.keys()].filter((path) => !desired.has(path));

    const conflicts: string[] = [];
    for (const path of [...toWrite, ...toRemove]) {
      if (isOurs(path, current.get(path), base.get(path))) continue;
      conflicts.push(path);
    }
    return { toWrite, toRemove, conflicts };
  }

  function isOurs(
    path: string,
    remoteRev: string | undefined,
    baseRev: string | undefined,
  ): boolean {
    if (uncertain.has(path)) return true;
    if (remoteRev === undefined) return true;
    if (remoteRev === baseRev) return true;
    if (producedRevs.get(path)?.includes(remoteRev)) return true;
    return false;
  }

  async function writeFiles(
    desired: Map<string, DesiredFile>,
    toWrite: readonly string[],
  ): Promise<Map<string, string | undefined>> {
    const written = new Map<string, string | undefined>();
    await Promise.all(
      toWrite.map(async (path) => {
        const d = desired.get(path)!;
        // Encrypted notes are sealed here, lazily, so only the files actually
        // being written pay the AES cost — and only after the conflict check
        // below has cleared, so an aborted save wastes no encryption.
        const bytes = d.stored ?? (d.seal ? await d.seal() : d.source);
        try {
          const rev = await store.write(path, bytes);
          track(path, d.source, rev);
          // Keep the decrypted-note cache warm for what we just wrote: `d.source`
          // is the note's plaintext enc-JSON, so a follow-up load (the next
          // live-pull) reuses it instead of re-reading + re-decrypting a note we
          // already hold. Only meaningful for encrypted note files.
          if (rev !== undefined && isEncNotePath(path)) {
            encNoteCache.set(path, { rev, json: d.source });
          }
          written.set(path, rev);
        } catch (err) {
          uncertain.add(path);
          throw err;
        }
      }),
    );
    return written;
  }

  // Re-read every freshly-written encrypted note file and confirm it decrypts
  // to the source we meant to store — the fsync-equivalent that makes deleting
  // the superseded plaintext safe (the ciphertext is proven committed first).
  async function verifyEncrypted(
    keys: SessionKeys,
    desired: Map<string, DesiredFile>,
    paths: readonly string[],
  ): Promise<void> {
    for (const path of paths) {
      if (!isEncNotePath(path)) continue;
      const d = desired.get(path);
      if (!d) continue;
      const readBack = await store.read(path);
      if (readBack === null)
        throw new Error(`verify: ${path} missing after write`);
      const opened = await openString(keys.contentKey, readBack);
      const text = new TextDecoder().decode(opened.bytes);
      if (text !== d.source) throw new Error(`verify: ${path} mismatch`);
    }
  }

  async function save(
    text: string,
    baseRevision?: string,
  ): Promise<StoredSnapshot> {
    const keys = await ensureKeys();
    const before = await store.list();
    const current = currentRevisions(before);
    const base = parseRevisions(baseRevision);

    const desired = new Map<string, DesiredFile>();
    // Which note each desired note-file path belongs to, so a path queued for
    // writing can drive the per-note upload spinner. The legacy blob has no
    // per-note mapping (it's one whole-document file), so it stays out of this.
    const pathToNoteId = new Map<string, string>();
    let snapshotForAttachments: Snapshot | null = null;
    let supersededKind: "toEncrypted" | "toBlob" | "toMarkdown" | null = null;

    if (keys) {
      // Encrypted per-file representation.
      const snapshot = parse(text);
      snapshotForAttachments = snapshot;
      for (const note of snapshot.notes) {
        const path = await encNotePath(keys, note.id);
        if (note.body === undefined) {
          // Deferred note (never opened this session): its body isn't in memory
          // to seal, so it must not be written — that would clobber the real
          // ciphertext with a body-less note. It stays in `desired` (so it's
          // never removed as an orphan) but flagged `skip`. A note that is
          // actually edited is loaded first (App.ensureLoaded fetches its body),
          // so a genuine change never arrives here still deferred.
          desired.set(path, { source: DEFERRED_SOURCE, skip: true });
          continue;
        }
        pathToNoteId.set(path, note.id);
        const source = noteToEncJson(note);
        // Seal lazily: only the notes `plan` selects for writing are encrypted
        // (see `DesiredFile`), so one edit in a large vault re-seals one note.
        desired.set(path, {
          source,
          seal: () => sealString(keys.contentKey, source),
        });
      }
      supersededKind = "toEncrypted";
    } else if (isEncryptedEnvelope(text)) {
      // Legacy single-blob envelope handed straight through (kept for the
      // browser backend path and back-compat).
      desired.set(BLOB_FILE_NAME, { stored: text, source: text });
      supersededKind = "toBlob";
    } else {
      const snapshot = parse(text);
      snapshotForAttachments = snapshot;
      // Remember the registry so the encryption migrate / demigrate paths can
      // resolve a note's physical folder directory the same way this save does.
      folderRegistry.rememberFolders(snapshot.folders ?? []);
      for (const note of snapshot.notes) {
        pathToNoteId.set(noteFilePath(note, snapshot.folders), note.id);
      }
      for (const file of snapshotToFiles(snapshot)) {
        desired.set(file.path, { stored: file.text, source: file.text });
      }
      supersededKind = "toMarkdown";
    }

    // Files of the representation we're leaving behind — removed unconditionally
    // (even untracked ones, since a load before the switch can be served from
    // the offline cache or a rebuilt adapter). Distinct paths per
    // representation mean this can't touch the one we're writing.
    const superseded = before
      .map((e) => e.path)
      .filter((path) => {
        if (!isOwnedPath(path) || desired.has(path)) return false;
        if (supersededKind === "toEncrypted") {
          return isMarkdownPath(path) || path === BLOB_FILE_NAME;
        }
        if (supersededKind === "toBlob") {
          return isMarkdownPath(path) || isEncNotePath(path);
        }
        // toMarkdown
        return isEncNotePath(path) || path === BLOB_FILE_NAME;
      });

    const { toWrite, toRemove, conflicts } = plan(desired, current, base);
    log.info(
      `${options.id} save: write=${toWrite.length} remove=${toRemove.length} conflicts=${conflicts.length} tracked=${tracked.size}`,
    );

    if (baseRevision !== undefined && conflicts.length > 0) {
      log.warn(`${options.id} save: remote moved on files we're writing`, {
        conflicts,
      });
      const remoteText = keys
        ? await readEncryptedSnapshot(keys, before)
        : await readSnapshot(before);
      throw new ConflictError({
        text: remoteText ?? serialize(parse(null)),
        revision: aggregateRevision(before),
      });
    }

    // Spin a per-note glyph while each changed note's file is actually being
    // pushed to the backend. Cleared in `finally` so a failed write (conflict,
    // offline, throttle) doesn't leave a note stuck "uploading".
    const uploadingNoteIds = toWrite
      .map((path) => pathToNoteId.get(path))
      .filter((id): id is string => id !== undefined);
    setUploading(uploadingNoteIds, true);
    let written: Map<string, string | undefined>;
    try {
      written = await writeFiles(desired, toWrite);
    } finally {
      setUploading(uploadingNoteIds, false);
    }

    // Write the new attachment blobs BEFORE deleting any superseded files, then
    // verify the new note ciphertext decrypts — so an interruption never leaves
    // a note without a readable representation.
    if (attachments) {
      if (keys && snapshotForAttachments) {
        await attachmentReconciler.reconcileEncrypted(
          keys,
          snapshotForAttachments,
          attBlobPath,
        );
      } else if (supersededKind === "toBlob") {
        // legacy: fold images into the blob → clear all externalised files.
        if (superseded.length > 0) await attachmentReconciler.clearAll();
      } else if (snapshotForAttachments) {
        await attachmentReconciler.reconcilePlaintext(snapshotForAttachments);
      }
    }

    if (keys && superseded.length > 0) {
      await verifyEncrypted(keys, desired, toWrite);
    }

    const removals = [...new Set([...toRemove, ...superseded])];
    await Promise.all(
      removals.map(async (path) => {
        await store.remove(path);
        tracked.delete(path);
        producedRevs.delete(path);
        uncertain.delete(path);
        encNoteCache.delete(path);
      }),
    );

    // Clear the superseded attachment representation only after the new note
    // files are written + verified.
    if (attachments && superseded.length > 0) {
      if (supersededKind === "toEncrypted") {
        await attachmentReconciler.clearWhere(
          (p) => !isPlaintextAttachmentPath(p),
        );
      } else if (supersededKind === "toMarkdown") {
        await attachmentReconciler.clearWhere(isPlaintextAttachmentPath);
      }
    }

    // Persist the folder registry sidecar (names + empty folders). The note
    // files carry only the folder id, so this is what makes a renamed or empty
    // folder survive on the file/cloud backends. Skipped on the legacy blob
    // path (no parsed snapshot) and a no-op when the registry didn't change.
    await persistFolders(snapshotForAttachments);

    const needsRelist = [...written.values()].some((rev) => rev === undefined);
    let revisions: Map<string, string>;
    if (needsRelist) {
      log.warn(
        `${options.id} save: a write returned no revision — re-listing (lag-prone)`,
      );
      revisions = currentRevisions(await store.list());
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

    // Refresh the note index so the next unlock renders from it. In encrypted
    // mode it's rebuilt from the snapshot (every note, deferred or loaded, with
    // its current `.enc` revision so the load can tell a fresh row from a stale
    // one). On a plaintext/legacy-blob save the index is stale, so it's removed
    // — both best-effort, never failing the save the per-note files already
    // committed.
    if (keys && snapshotForAttachments) {
      const entries = await Promise.all(
        snapshotForAttachments.notes.map(async (note) =>
          noteToIndexEntry(
            note,
            revisions.get(await encNotePath(keys, note.id)),
          ),
        ),
      );
      await sealWriteIndex(keys, entries);
    } else if (before.some((e) => e.path === INDEX_FILE_NAME)) {
      await store.remove(INDEX_FILE_NAME).catch(() => {});
    }

    const revision = revLines(revisions);
    log.info(`${options.id} save: committed -> rev=${shortRev(revision)}`);
    return { text, revision };
  }

  // Fetch one attachment's bytes on demand (used by the UI when a note is
  // opened). Decrypts the opaque blob in encrypted mode; reads the note-stem
  // file in plaintext mode. Returns null when the file is missing.
  async function fetchAttachment(
    note: Note,
    filename: string,
  ): Promise<{ mime: string; bytes: Uint8Array } | null> {
    if (!attachments) return null;
    const keys = await ensureKeys();
    if (keys) {
      const ref = await attBlobPath(keys, note.id, filename);
      const blob = await attachments.read(ref);
      if (!blob) return null;
      const opened = await openBytes(keys.contentKey, blob);
      const mime = (opened.header.mime as string) ?? mimeForFilename(filename);
      return { mime, bytes: opened.bytes };
    }
    const bytes = await attachments.read(
      attachmentPath(noteFileStem(note), filename),
    );
    if (!bytes) return null;
    return { mime: mimeForFilename(filename), bytes };
  }

  // Fetch one note's body on demand — the lazy counterpart of the index load.
  // The encrypted load renders the list from the index with every body deferred
  // (`undefined`); opening a note (or the background warm pass) calls this to
  // decrypt its `.enc` and return the body. Returns null in plaintext mode (the
  // body is already loaded) and when the file is missing. Decrypting also warms
  // `encNoteCache` and re-tracks the path with the note's real source, so the
  // body stays loaded across reloads and a later save of the now-loaded note
  // doesn't see it as changed and needlessly re-upload it.
  async function fetchNoteBody(note: Note): Promise<string | null> {
    const keys = await ensureKeys();
    if (!keys) return null;
    const path = await encNotePath(keys, note.id);
    // Serve an already-decrypted body from the session cache without a network
    // read — so the background warm pass and a re-open are cheap, and a note
    // warmed this session opens even after the backend goes offline.
    const cached = encNoteCache.get(path);
    let json: string;
    if (cached) {
      json = cached.json;
    } else {
      const text = await store.read(path);
      if (text === null) return null;
      const opened = await openString(keys.contentKey, text);
      json = new TextDecoder().decode(opened.bytes);
      const rev = tracked.get(path)?.rev;
      encNoteCache.set(path, { rev: rev ?? "", json });
      // Re-track with the real enc-JSON so the note no longer looks "changed"
      // versus the deferred sentinel it was tracked under at load time.
      if (rev !== undefined) track(path, json, rev);
    }
    const decoded = encJsonToNote(json);
    return decoded ? (decoded.body ?? "") : null;
  }

  // Per-note at-rest encryption status from the last load. Empty in plaintext
  // mode (no locks shown).
  function getEncryptionStatus(): Map<string, NoteEncStatus> {
    return new Map(encStatus);
  }

  // Rebuild + seal the note index from the given snapshot's notes, best-effort.
  // The background encryption migration seals notes one at a time via
  // `migrateNote`, which doesn't touch the index, so without this the index
  // isn't written until the next regular save — meaning the first unlock after
  // enabling encryption would decrypt every note in the per-file fallback
  // instead of rendering instantly from the index. Calling this once the
  // conversion finishes closes that gap. A no-op while locked / in plaintext
  // mode. Each entry carries its note's current `.enc` revision (read fresh from
  // the listing) so the next load can tell the row is up to date and defer the
  // body. Failures are swallowed by `sealWriteIndex` (it's a pure optimisation).
  async function refreshIndex(notes: readonly Note[]): Promise<void> {
    const keys = await ensureKeys();
    if (!keys) return;
    let revisions: Map<string, string>;
    try {
      revisions = currentRevisions(await store.list());
    } catch (err) {
      log.warn(`${options.id} index: refresh listing failed (non-fatal)`, err);
      return;
    }
    const entries = await Promise.all(
      notes.map(async (note) =>
        noteToIndexEntry(note, revisions.get(await encNotePath(keys, note.id))),
      ),
    );
    await sealWriteIndex(keys, entries);
  }

  // The plain↔encrypted per-note migration converters
  // (migrate/demigrate/splitLegacyBlob). Lifted into their own module; they
  // reach back here only through the explicit deps below, so the byte-level
  // behaviour is unchanged. `setEncStatus`/`deleteEncStatus` are callbacks (not
  // the `encStatus` Map itself) because the load path reassigns its binding — a
  // closure always sees the current map. Created after `save` because the legacy
  // split reuses it for the representation switch.
  const { migrateNote, demigrateNote, splitLegacyBlob } =
    createMigrationConverters({
      id: options.id,
      store,
      attachments,
      passwordRef: crypto?.passwordRef,
      ensureKeys,
      encNotePath,
      attBlobPath,
      encNoteCache,
      plaintextNotePath,
      track,
      untrack: (path) => tracked.delete(path),
      setEncStatus: (noteId, status) => encStatus.set(noteId, status),
      deleteEncStatus: (noteId) => encStatus.delete(noteId),
      blobFileName: BLOB_FILE_NAME,
      isEncNotePath,
      save,
    });

  const capabilities = new Set<AdapterCapability>();
  if (attachments) capabilities.add("attachments");

  return {
    id: options.id,
    label: options.label,
    saveDebounceMs: options.saveDebounceMs,
    capabilities,
    load,
    save,
    fetchAttachment,
    fetchNoteBody,
    getEncryptionStatus,
    refreshIndex,
    migrateNote,
    demigrateNote,
    splitLegacyBlob,
    watchUploads,
  };
}
