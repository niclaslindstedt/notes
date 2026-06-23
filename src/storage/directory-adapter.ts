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
  NoteConversionProgress,
  StorageAdapter,
  StoredSnapshot,
} from "./adapter.ts";
import { ConflictError } from "./adapter.ts";
import { type AttachmentStore, dataUrlToBytes } from "./attachment-store.ts";
import {
  type SessionKeys,
  decryptEnvelope,
  deriveRef,
  deriveSessionKeys,
  isEncryptedEnvelope,
  newKeyParams,
  parseKeyParams,
  serializeKeyParams,
} from "./crypto.ts";
import {
  openBytes,
  openString,
  sealBytes,
  sealString,
} from "./crypto-binary.ts";
import type { FileEntry, FileStore } from "./file-store.ts";
import {
  filesToSnapshot,
  noteFilePath,
  noteFileStem,
  noteToMarkdown,
  snapshotToFiles,
} from "./markdown/codec.ts";
import {
  parse,
  parseFolders,
  serialize,
  serializeFolders,
} from "./serialize.ts";
import {
  type Attachment,
  mimeForFilename,
  referencedAttachments,
} from "../domain/attachment.ts";
import type { Folder, Note, Snapshot } from "../domain/note.ts";
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
// The non-secret KDF salts for this folder's encryption, so any device with the
// passphrase derives the same keys and resolves the same opaque names.
export const KEY_PARAMS_FILE = ".keyparams.json";
// The folder registry sidecar (display names + empty folders), beside the note
// files in the namespace's notes folder. Like the namespace / settings
// registries it's plaintext JSON — folder names aren't secret, and a note's
// `folder` frontmatter only carries the id — and metadata, not a note: it's
// never read as a note nor removed on a representation switch. Notes carry only
// the folder *id*; this maps id → name and keeps a folder that holds no notes.
export const FOLDERS_FILE_NAME = "folders.json";
// Suffix of an encrypted per-note file. The stem is the opaque keyed-HMAC ref.
const ENC_SUFFIX = ".enc";

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

// A plaintext attachment file is grouped under a note-stem folder (`<stem>/…`);
// an encrypted attachment blob is a flat opaque ref (no slash). Telling them
// apart lets a representation switch clear only the superseded kind.
function isPlaintextAttachmentPath(path: string): boolean {
  return path.includes("/");
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
};

// The on-disk path of a plaintext attachment file, relative to the attachment
// store root: `<note-stem>/<filename>`.
function attachmentPath(stem: string, filename: string): string {
  return `${stem}/${filename}`;
}

function stemOfAttachmentPath(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

type Tracked = {
  hash: number;
  rev: string;
};

// Minimal per-note JSON stored inside an encrypted note file: the note minus
// its attachment *bytes* (those live in their own blobs), plus attachment
// metadata so the load knows what to fetch. The opaque ref is re-derived, never
// stored.
type EncAttachmentMeta = { filename: string; mime: string };

function noteToEncJson(note: Note): string {
  const meta: EncAttachmentMeta[] = (note.attachments ?? []).map((a) => ({
    filename: a.filename,
    mime: a.mime,
  }));
  const obj: Record<string, unknown> = {
    id: note.id,
    title: note.title,
    body: note.body,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
  if (note.archived) obj.archived = true;
  if (note.folderId) obj.folderId = note.folderId;
  if (meta.length > 0) obj.attachments = meta;
  return JSON.stringify(obj);
}

function encJsonToNote(json: string): Note | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Record<string, unknown>;
  if (
    typeof n.id !== "string" ||
    typeof n.body !== "string" ||
    typeof n.createdAt !== "number" ||
    typeof n.updatedAt !== "number"
  ) {
    return null;
  }
  const note: Note = {
    id: n.id,
    title: typeof n.title === "string" ? n.title : "",
    body: n.body,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
  if (n.archived === true) note.archived = true;
  if (typeof n.folderId === "string" && n.folderId.length > 0) {
    note.folderId = n.folderId;
  }
  if (Array.isArray(n.attachments)) {
    const meta: Attachment[] = [];
    for (const a of n.attachments) {
      if (a && typeof a === "object") {
        const m = a as Record<string, unknown>;
        if (typeof m.filename === "string" && typeof m.mime === "string") {
          // Metadata only — the bytes live in a separate blob, fetched on demand.
          meta.push({ filename: m.filename, mime: m.mime });
        }
      }
    }
    if (meta.length > 0) note.attachments = meta;
  }
  return note;
}

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

  let attachmentsTouched = false;
  const uncertain = new Set<string>();

  // The canonical JSON of the folder registry as it currently stands on disk
  // (null = no `folders.json` sidecar exists). Set on every load and after each
  // write so `save` skips a redundant rewrite when the folders didn't change.
  let lastFoldersJson: string | null = null;

  // The folder registry from the last load / save, kept so the per-note
  // encryption migrate / demigrate paths (which only receive a `Note`) can
  // resolve a note's physical folder directory the same way `snapshotToFiles`
  // does. The plaintext `.md` of a grouped note lives at `<folder-dir>/<stem>.md`.
  let lastFolders: Folder[] = [];

  // The path a note's plaintext `.md` file lives at, folder-aware.
  function plaintextNotePath(note: Note): string {
    return noteFilePath(note, lastFolders);
  }

  // Read the folder registry sidecar, tolerating a missing / corrupt file by
  // yielding no folders. Records the canonical bytes so the next save can tell
  // whether the registry actually changed.
  //
  // The sidecar is read directly rather than gated on the directory listing: a
  // cloud `list()` is only eventually consistent — right after startup Dropbox's
  // `list_folder` can omit `folders.json` even though it's really there — while
  // a read of a known path is strongly consistent. Trusting the listing made a
  // cold-start load (unlock on app start / upgrade reload) drop every folder,
  // and the load memo cached that folderless snapshot until the adapter was
  // rebuilt (the "switch namespaces back and forth" workaround). The folders are
  // the registry's, so this also keeps *empty* folders — the ones no note links
  // to — which a notes-only reconstruction would lose. The extra read is paid
  // only when the listing actually moved: an unchanged backend is served from
  // the load memo above, which never reaches here.
  async function readFolders(): Promise<Folder[]> {
    let raw: string | null;
    try {
      raw = await store.read(FOLDERS_FILE_NAME);
    } catch {
      raw = null;
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
    return folders;
  }

  // Fold the registry's folders into a snapshot's text on load — the notes are
  // rebuilt from the `.md` / `.enc` files and carry only a folder *id*, so the
  // names (and any empty folders) come from the sidecar. The legacy single-blob
  // envelope is opaque, so it's left untouched.
  function injectFolders(text: string, folders: readonly Folder[]): string {
    if (folders.length === 0 || isEncryptedEnvelope(text)) return text;
    const snap = parse(text);
    snap.folders = [...folders];
    return serialize(snap);
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

  // Per-note at-rest encryption status from the last encrypted load: a note is
  // "encrypted" once its `.enc` file exists and none of its attachments linger
  // as a plaintext file; "pending" while a plaintext remnant remains (an
  // in-progress migration). Drives the green lock in the UI.
  type NoteEncStatus = "encrypted" | "pending";
  let encStatus = new Map<string, NoteEncStatus>();

  // Session keys, derived once per passphrase. The key-params file is read (or
  // created) the first time encryption is active, so every device shares salts.
  let keyCache: { password: string; keys: SessionKeys } | null = null;
  // Memoised opaque file refs. `deriveRef` is a keyed HMAC of the session
  // fileKey + a stable label/id, so within a session each ref is deterministic
  // and cheap to remember — this turns the per-save path computation (one HMAC
  // per note, every save) into a map lookup after the first time. Cleared
  // whenever the keys change (password switch / lock) since the fileKey does.
  const refCache = new Map<string, string>();
  // Per-note decrypted-JSON cache, keyed by the encrypted note's path and the
  // file revision the plaintext was unsealed from. Lets a load skip the network
  // read + AES-GCM open for every `.enc` file whose revision hasn't moved, so a
  // remote edit to one note re-decrypts that note alone instead of the whole
  // vault (the encrypted-mode counterpart of the plaintext path's `reusableFiles`).
  // Cleared whenever the keys change.
  const encNoteCache = new Map<string, { rev: string; json: string }>();
  // The snapshot the last load produced, keyed by the full listing fingerprint.
  // When a fresh `store.list()` proves the on-disk state is byte-identical, the
  // load returns this without re-reading or re-decrypting anything — collapsing
  // the unlock's two back-to-back loads (gate verifies, then the adapter swap
  // reloads) into one decrypt, and making an idle live-pull cost a single
  // listing. Listing is always re-run, so this never serves data staler than the
  // backend. Cleared whenever the keys change.
  let lastLoad: { key: string; snapshot: StoredSnapshot } | null = null;
  // The passphrase `ensureKeys` last observed, so a change (lock / unlock /
  // switch) can drop every key-derived cache — including the plaintext-safe
  // `lastLoad` — exactly once on transition, not on every plaintext load.
  let lastPassword: string | null = null;
  async function ensureKeys(): Promise<SessionKeys | null> {
    const password = crypto?.passwordRef.current ?? null;
    if (password !== lastPassword) {
      // Key state changed → everything derived from the old key is stale.
      refCache.clear();
      encNoteCache.clear();
      lastLoad = null;
      lastPassword = password;
    }
    if (!password) {
      keyCache = null;
      return null;
    }
    if (keyCache && keyCache.password === password) return keyCache.keys;
    let params = parseKeyParams(await store.read(KEY_PARAMS_FILE));
    if (!params) {
      params = newKeyParams();
      await store.write(KEY_PARAMS_FILE, serializeKeyParams(params));
    }
    const keys = await deriveSessionKeys(password, params);
    keyCache = { password, keys };
    return keys;
  }

  async function cachedRef(
    keys: SessionKeys,
    label: string,
    id: string,
  ): Promise<string> {
    const cacheKey = `${label} ${id}`;
    let ref = refCache.get(cacheKey);
    if (ref === undefined) {
      ref = await deriveRef(keys.fileKey, label, id);
      refCache.set(cacheKey, ref);
    }
    return ref;
  }

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
    // Encrypted notes (already migrated), unsealed with a bounded pool. On a
    // cloud backend each read is a network fetch, so overlapping them turns a
    // cold load from O(notes) sequential round-trips into a handful of waves.
    // The per-note reporter still drives the unlock gate's status line, but a
    // note's title lives inside its ciphertext (unknown until decrypted), so it
    // fires as each note finishes with a completion counter for `index` — the
    // line updates live, just not in on-disk order.
    const reportNote = crypto?.onDecryptNote?.current;
    let decrypted = 0;
    const opened = await mapWithConcurrency(
      encPaths,
      ENC_LOAD_CONCURRENCY,
      async (path) => {
        const rev = revisions.get(path) ?? "";
        // Reuse the plaintext we already unsealed for this exact file revision —
        // no network read, no AES open. A re-encryption uses a fresh IV and so
        // bumps the rev, meaning a cache hit can never serve a note's stale
        // plaintext: a changed note always misses and is re-read.
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
            total: encPaths.length,
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
      if (entry.note) {
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
      await attachEncryptedMetadata(notes, status);
    } else if (notes.some((n) => n.attachments?.length)) {
      attachmentsTouched = true;
    }
    encStatus = status;
    return serialize({ notes });
  }

  // Fill in attachment metadata (filename + mime) for the loaded notes and
  // downgrade any note still holding a plaintext attachment file to "pending".
  // Encrypted notes already carry their attachment metadata (from the note
  // file); plaintext remnants get theirs from the attachment listing.
  async function attachEncryptedMetadata(
    notes: Note[],
    status: Map<string, NoteEncStatus>,
  ): Promise<void> {
    if (!attachments) return;
    let entries: { path: string }[];
    try {
      entries = await attachments.list();
    } catch (err) {
      log.warn(`${options.id} load: listing enc attachments failed`, err);
      return;
    }
    if (entries.length === 0) return;
    attachmentsTouched = true;
    // Plaintext attachment files still on disk, grouped by note stem.
    const plaintextByStem = new Map<string, string[]>();
    for (const entry of entries) {
      if (!isPlaintextAttachmentPath(entry.path)) continue;
      const stem = stemOfAttachmentPath(entry.path);
      const list = plaintextByStem.get(stem) ?? [];
      list.push(entry.path);
      plaintextByStem.set(stem, list);
    }
    for (const note of notes) {
      const stem = noteFileStem(note);
      const plaintext = plaintextByStem.get(stem);
      if (plaintext && plaintext.length > 0) {
        // A plaintext attachment file lingers → the note isn't fully encrypted.
        status.set(note.id, "pending");
        if (!note.attachments) {
          note.attachments = plaintext.map((p) => {
            const filename = p.slice(stem.length + 1);
            return { filename, mime: mimeForFilename(filename) };
          });
        }
      }
    }
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
        ? await hydrateAttachments(text)
        : text;
    const result = { text: injectFolders(hydrated, folders), revision };
    lastLoad = { key: fingerprint, snapshot: result };
    return result;
  }

  // -- Plaintext attachment hydration / reconcile (unchanged) ----------------

  // Attach each note's attachment *metadata* (filename + mime) from the file
  // listing, without reading any bytes — those are fetched on demand when a note
  // is opened (`fetchAttachment`), so the list loads without every note's
  // images.
  async function hydrateAttachments(text: string): Promise<string> {
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
    const byStem = new Map<string, string[]>();
    for (const entry of entries) {
      const stem = stemOfAttachmentPath(entry.path);
      if (!stem) continue;
      const list = byStem.get(stem) ?? [];
      list.push(entry.path);
      byStem.set(stem, list);
    }

    for (const note of snapshot.notes) {
      const stem = noteFileStem(note);
      const paths = byStem.get(stem);
      if (!paths || paths.length === 0) continue;
      const out: Attachment[] = paths.map((path) => {
        const filename = path.slice(stem.length + 1);
        return { filename, mime: mimeForFilename(filename) };
      });
      if (out.length > 0) note.attachments = out;
    }
    return serialize(snapshot);
  }

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

  async function reconcileAttachments(snapshot: Snapshot): Promise<void> {
    const desired = desiredAttachments(snapshot);
    if (desired.size === 0 && !attachmentsTouched) return;
    if (desired.size > 0) attachmentsTouched = true;
    let current: { path: string }[];
    try {
      current = await attachments!.list();
    } catch (err) {
      log.warn(`${options.id} save: listing attachments failed`, err);
      current = [];
    }
    // Only the plaintext attachment files are this path's concern; a flat
    // opaque blob belongs to the encrypted representation.
    const currentPaths = new Set(
      current.map((e) => e.path).filter(isPlaintextAttachmentPath),
    );
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
        if (!decoded) return;
        await attachments!.write(path, decoded.bytes, decoded.mime);
      }),
    );
    await Promise.all(toRemove.map((path) => attachments!.remove(path)));
  }

  // Remove externalised files of a representation we're leaving behind, filtered
  // by predicate so the encrypted blobs and the plaintext files don't wipe each
  // other out.
  async function clearAttachmentsWhere(
    keep: (path: string) => boolean,
  ): Promise<void> {
    let current: { path: string }[];
    try {
      current = await attachments!.list();
    } catch (err) {
      log.warn(`${options.id} save: listing attachments to clear failed`, err);
      return;
    }
    const drop = current.map((e) => e.path).filter((p) => !keep(p));
    if (drop.length === 0) return;
    log.info(`${options.id} save: clearing ${drop.length} attachment file(s)`);
    await Promise.all(drop.map((path) => attachments!.remove(path)));
  }

  // Legacy: clear every externalised attachment file (used when the document is
  // converted to the single-blob envelope, the historical encrypted format).
  async function clearAttachments(): Promise<void> {
    await clearAttachmentsWhere(() => false);
  }

  // -- Encrypted attachment reconcile ---------------------------------------

  // The encrypted attachment blobs a snapshot wants on disk, keyed by opaque
  // ref. Every referenced attachment is desired (so an existing one isn't
  // removed even when its bytes aren't in memory); only those that still carry
  // bytes are (re)written.
  async function encDesiredAttachments(
    keys: SessionKeys,
    snapshot: Snapshot,
  ): Promise<Map<string, Attachment>> {
    const desired = new Map<string, Attachment>();
    for (const note of snapshot.notes) {
      for (const a of referencedAttachments(note.body, note.attachments)) {
        desired.set(await attBlobPath(keys, note.id, a.filename), a);
      }
    }
    return desired;
  }

  async function reconcileEncryptedAttachments(
    keys: SessionKeys,
    snapshot: Snapshot,
  ): Promise<void> {
    const desired = await encDesiredAttachments(keys, snapshot);
    if (desired.size === 0 && !attachmentsTouched) return;
    if (desired.size > 0) attachmentsTouched = true;
    let current: { path: string }[];
    try {
      current = await attachments!.list();
    } catch (err) {
      log.warn(`${options.id} save: listing enc attachments failed`, err);
      current = [];
    }
    const currentBlobs = new Set(
      current.map((e) => e.path).filter((p) => !isPlaintextAttachmentPath(p)),
    );
    if (currentBlobs.size > 0) attachmentsTouched = true;

    const toWrite: [string, Attachment][] = [];
    for (const [path, attachment] of desired) {
      // Already on disk (content-addressed by ref → bytes never change) → skip;
      // or no bytes in memory to write → skip (it must already exist).
      if (currentBlobs.has(path) || !attachment.data) continue;
      toWrite.push([path, attachment]);
    }
    const toRemove = [...currentBlobs].filter((p) => !desired.has(p));
    if (toWrite.length === 0 && toRemove.length === 0) return;
    log.info(
      `${options.id} save: enc attachments write=${toWrite.length} remove=${toRemove.length}`,
    );

    await Promise.all(
      toWrite.map(async ([path, attachment]) => {
        const decoded = dataUrlToBytes(attachment.data);
        if (!decoded) return;
        const blob = await sealBytes(keys.contentKey, decoded.bytes, {
          mime: decoded.mime,
          filename: attachment.filename,
        });
        await attachments!.write(path, blob, "application/octet-stream");
      }),
    );
    await Promise.all(toRemove.map((path) => attachments!.remove(path)));
  }

  // -- Shared save machinery -------------------------------------------------

  function plan(
    desired: Map<string, DesiredFile>,
    current: ReadonlyMap<string, string>,
    base: ReadonlyMap<string, string>,
  ): { toWrite: string[]; toRemove: string[]; conflicts: string[] } {
    const toWrite: string[] = [];
    for (const [path, d] of desired) {
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
      lastFolders = snapshot.folders ?? [];
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
        await reconcileEncryptedAttachments(keys, snapshotForAttachments);
      } else if (supersededKind === "toBlob") {
        // legacy: fold images into the blob → clear all externalised files.
        if (superseded.length > 0) await clearAttachments();
      } else if (snapshotForAttachments) {
        await reconcileAttachments(snapshotForAttachments);
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
        await clearAttachmentsWhere((p) => !isPlaintextAttachmentPath(p));
      } else if (supersededKind === "toMarkdown") {
        await clearAttachmentsWhere((p) => isPlaintextAttachmentPath(p));
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

  // Per-note at-rest encryption status from the last load. Empty in plaintext
  // mode (no locks shown).
  function getEncryptionStatus(): Map<string, NoteEncStatus> {
    return new Map(encStatus);
  }

  // Convert ONE note from plaintext to its encrypted per-file form, atomically:
  // seal each attachment's bytes into its opaque blob, write + verify the
  // encrypted note file, then remove the superseded plaintext `.md` and
  // attachment files. Idempotent — a note already migrated is a no-op. This is
  // the unit the paced migration queue drives, so a large conversion never
  // bursts the cloud API. `onStep` fires before each attachment and before the
  // note file so the UI can flash what it's sealing. Returns true when this call
  // did work.
  async function migrateNote(
    note: Note,
    onStep?: NoteConversionProgress,
  ): Promise<boolean> {
    const keys = await ensureKeys();
    if (!keys) return false;
    const stem = noteFileStem(note);
    // The plaintext note lives at its folder-aware path; tolerate a flat path
    // too (a document written before folders became physical, or one a
    // plaintext save hasn't re-placed yet) so enabling encryption never leaves
    // a plaintext copy stranded on disk.
    const folderPath = plaintextNotePath(note);
    const flatPath = `${stem}.md`;
    const mdPath =
      (await store.read(folderPath)) !== null
        ? folderPath
        : (await store.read(flatPath)) !== null
          ? flatPath
          : null;
    // Already migrated (no plaintext note file left)?
    if (mdPath === null) {
      encStatus.set(note.id, "encrypted");
      return false;
    }

    // 1. Seal each attachment's bytes from its plaintext file into a blob.
    if (attachments) {
      for (const a of note.attachments ?? []) {
        onStep?.({ phase: "attachment", filename: a.filename });
        const blobPath = await attBlobPath(keys, note.id, a.filename);
        if ((await attachments.read(blobPath)) !== null) continue;
        const bytes = await attachments.read(attachmentPath(stem, a.filename));
        if (!bytes) continue;
        const blob = await sealBytes(keys.contentKey, bytes, {
          mime: a.mime,
          filename: a.filename,
        });
        await attachments.write(blobPath, blob, "application/octet-stream");
      }
    }

    // 2. Write + verify the encrypted note file.
    onStep?.({ phase: "note" });
    const encPath = await encNotePath(keys, note.id);
    const source = noteToEncJson(note);
    const rev = await store.write(
      encPath,
      await sealString(keys.contentKey, source),
    );
    track(encPath, source, rev);
    if (rev !== undefined) encNoteCache.set(encPath, { rev, json: source });
    const readBack = await store.read(encPath);
    if (readBack === null) throw new Error("migrate: enc note missing");
    const opened = await openString(keys.contentKey, readBack);
    if (new TextDecoder().decode(opened.bytes) !== source) {
      throw new Error("migrate: verify mismatch");
    }

    // 3. Remove the superseded plaintext only after the ciphertext is proven.
    await store.remove(mdPath);
    tracked.delete(mdPath);
    if (attachments) {
      for (const a of note.attachments ?? []) {
        await attachments
          .remove(attachmentPath(stem, a.filename))
          .catch(() => {});
      }
    }
    encStatus.set(note.id, "encrypted");
    return true;
  }

  // The exact reverse of `migrateNote`: convert ONE note from its encrypted
  // per-file form back to plaintext, atomically — decrypt each attachment blob
  // into its plaintext `<stem>/<filename>` file, write + verify the plaintext
  // `.md` note, then remove the superseded `.enc` note and opaque attachment
  // blobs. Same write-new → verify → delete-old ordering as the forward path, so
  // an interruption leaves both representations for an idempotent resume rather
  // than losing data. Idempotent — a note already plaintext is a no-op. This is
  // the unit the paced de-encryption queue drives. Returns true when it worked.
  async function demigrateNote(
    note: Note,
    onStep?: NoteConversionProgress,
  ): Promise<boolean> {
    const keys = await ensureKeys();
    if (!keys) return false;
    const encPath = await encNotePath(keys, note.id);
    // Already demigrated (no encrypted note file left)?
    if ((await store.read(encPath)) === null) {
      encStatus.delete(note.id);
      return false;
    }
    const stem = noteFileStem(note);

    // 1. Decrypt each attachment blob back into its plaintext file.
    if (attachments) {
      for (const a of note.attachments ?? []) {
        onStep?.({ phase: "attachment", filename: a.filename });
        const plainPath = attachmentPath(stem, a.filename);
        if ((await attachments.read(plainPath)) !== null) continue;
        const blob = await attachments.read(
          await attBlobPath(keys, note.id, a.filename),
        );
        if (!blob) continue;
        const opened = await openBytes(keys.contentKey, blob);
        const mime = (opened.header.mime as string) ?? a.mime;
        await attachments.write(plainPath, new Uint8Array(opened.bytes), mime);
      }
    }

    // 2. Write + verify the plaintext markdown note file at its folder-aware
    // path, so disabling encryption lands a grouped note back in its folder
    // directory rather than flat at the notes root.
    onStep?.({ phase: "note" });
    const mdPath = plaintextNotePath(note);
    const text = noteToMarkdown(note, mdPath.includes("/") ? 1 : 0);
    const rev = await store.write(mdPath, text);
    track(mdPath, text, rev);
    const readBack = await store.read(mdPath);
    if (readBack === null) throw new Error("demigrate: md note missing");
    if (readBack !== text) throw new Error("demigrate: verify mismatch");

    // 3. Remove the superseded ciphertext only after the plaintext is proven.
    await store.remove(encPath);
    tracked.delete(encPath);
    encNoteCache.delete(encPath);
    if (attachments) {
      for (const a of note.attachments ?? []) {
        await attachments
          .remove(await attBlobPath(keys, note.id, a.filename))
          .catch(() => {});
      }
    }
    encStatus.delete(note.id);
    return true;
  }

  // One-time upgrade for existing users: a legacy whole-document `notes.json`
  // envelope is decrypted and re-saved as the per-file form, then the blob is
  // removed (the save's representation-switch supersede handles that atomically:
  // the per-file notes + attachment blobs are written and verified before the
  // blob goes). The legacy blob folds attachment bytes inline, so the decrypted
  // snapshot carries them and they land in their own encrypted blobs. Idempotent
  // and a no-op once split. Returns true when it did the split.
  async function splitLegacyBlob(): Promise<boolean> {
    const keys = await ensureKeys();
    if (!keys) return false;
    const password = crypto?.passwordRef.current;
    if (!password) return false;
    const entries = await store.list();
    if (!entries.some((e) => e.path === BLOB_FILE_NAME)) return false;
    // Already split (per-file notes exist) — nothing to do.
    if (entries.some((e) => isEncNotePath(e.path))) return false;
    const blob = await store.read(BLOB_FILE_NAME);
    if (!blob || !isEncryptedEnvelope(blob)) return false;
    log.info(`${options.id}: splitting legacy notes.json into per-file form`);
    const plaintext = await decryptEnvelope(blob, password);
    // save() in encrypted mode writes per-file + reconciles attachment blobs
    // from the inline data + supersedes (removes) notes.json after verifying.
    await save(plaintext);
    for (const note of parse(plaintext).notes) {
      encStatus.set(note.id, "encrypted");
    }
    return true;
  }

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
    getEncryptionStatus,
    migrateNote,
    demigrateNote,
    splitLegacyBlob,
    watchUploads,
  };
}
