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
  noteFileStem,
  snapshotToFiles,
} from "./markdown/codec.ts";
import { parse, serialize } from "./serialize.ts";
import {
  type Attachment,
  mimeForFilename,
  referencedAttachments,
} from "../domain/attachment.ts";
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
// The non-secret KDF salts for this folder's encryption, so any device with the
// passphrase derives the same keys and resolves the same opaque names.
export const KEY_PARAMS_FILE = ".keyparams.json";
// Suffix of an encrypted per-note file. The stem is the opaque keyed-HMAC ref.
const ENC_SUFFIX = ".enc";

// The session passphrase, by reference so it can change at runtime (unlock /
// enable / disable) without rebuilding the adapter.
export type DirectoryCrypto = {
  passwordRef: { readonly current: string | null };
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
// hash for change detection (`source`). In plaintext mode the two are equal; in
// encrypted mode `stored` is fresh ciphertext (new IV every time) while
// `source` is the stable plaintext, so an unchanged note isn't re-uploaded.
type DesiredFile = { stored: string; source: string };

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

  // Session keys, derived once per passphrase. The key-params file is read (or
  // created) the first time encryption is active, so every device shares salts.
  let keyCache: { password: string; keys: SessionKeys } | null = null;
  async function ensureKeys(): Promise<SessionKeys | null> {
    const password = crypto?.passwordRef.current ?? null;
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
    return `${await deriveRef(keys.fileKey, "note", noteId)}${ENC_SUFFIX}`;
  }

  async function attBlobPath(
    keys: SessionKeys,
    noteId: string,
    filename: string,
  ): Promise<string> {
    return deriveRef(keys.fileKey, "att", `${noteId} ${filename}`);
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
    if (encPaths.length === 0) {
      // A legacy whole-document envelope: decrypt it with the passphrase so the
      // document survives. The next save rewrites it as per-file `.enc`.
      if (entries.some((e) => e.path === BLOB_FILE_NAME)) {
        const blob = await store.read(BLOB_FILE_NAME);
        const password = crypto?.passwordRef.current;
        if (blob && password && isEncryptedEnvelope(blob)) {
          track(BLOB_FILE_NAME, blob, revisions.get(BLOB_FILE_NAME));
          return decryptEnvelope(blob, password);
        }
        return blob;
      }
      return null;
    }
    const notes: Note[] = [];
    for (const path of encPaths) {
      const text = await store.read(path);
      if (text === null) continue;
      const opened = await openString(keys.contentKey, text);
      const json = new TextDecoder().decode(opened.bytes);
      track(path, json, revisions.get(path));
      const note = encJsonToNote(json);
      if (note) notes.push(note);
    }
    // Attachments are NOT read here — a note loads with its attachments'
    // metadata only and the bytes are fetched on demand (see `fetchAttachment`)
    // when the note is opened, so the list loads without every note's images.
    if (notes.some((n) => n.attachments?.length)) attachmentsTouched = true;
    return serialize({ notes });
  }

  async function load(
    previous?: StoredSnapshot,
  ): Promise<StoredSnapshot | null> {
    const keys = await ensureKeys();
    const entries = await store.list();
    tracked.clear();
    uncertain.clear();
    const revision = aggregateRevision(entries);

    if (keys) {
      const text = await readEncryptedSnapshot(keys, entries);
      if (text === null) return null;
      log.info(`${options.id} load (encrypted): rev=${shortRev(revision)}`);
      return { text, revision };
    }

    const reuse = reusableFiles(previous, entries);
    const text = await readSnapshot(entries, reuse);
    if (text === null) return null;
    const mdCount = entries.filter((e) => isMarkdownPath(e.path)).length;
    log.info(
      `${options.id} load: rev=${shortRev(revision)} files=${mdCount} reused=${reuse.size} fetched=${mdCount - reuse.size}`,
    );
    const hydrated =
      attachments && !isEncryptedEnvelope(text)
        ? await hydrateAttachments(text)
        : text;
    return { text: hydrated, revision };
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
        try {
          const rev = await store.write(path, d.stored);
          track(path, d.source, rev);
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
    let snapshotForAttachments: Snapshot | null = null;
    let supersededKind: "toEncrypted" | "toBlob" | "toMarkdown" | null = null;

    if (keys) {
      // Encrypted per-file representation.
      const snapshot = parse(text);
      snapshotForAttachments = snapshot;
      for (const note of snapshot.notes) {
        const path = await encNotePath(keys, note.id);
        const source = noteToEncJson(note);
        desired.set(path, {
          source,
          stored: await sealString(keys.contentKey, source),
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

    const written = await writeFiles(desired, toWrite);

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
  };
}
