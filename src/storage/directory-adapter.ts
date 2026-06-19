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
// the store reports for the whole directory; a save lists first and raises
// `ConflictError` when the aggregate moved past the caller's `baseRevision`.
//
// Two details keep that from firing falsely against a single device's own
// writes, which is the failure the cloud backends used to hit constantly:
//
//   1. The post-save revision is built from the revisions the writes *return*,
//      never from a follow-up `list()`. Cloud list endpoints (Dropbox's
//      `list_folder`, Drive's `files.list`) are eventually consistent: for a
//      moment after a write they still report the previous state. Re-listing
//      there stamped a stale revision into the caller's baseline, and every
//      later save then saw the now-settled listing as "moved" and raised a
//      phantom conflict until the next reload.
//   2. The pre-save drift check tolerates a listing that lags one of *our
//      own* recent writes. A back-to-back queued save lists immediately after
//      the prior write, before propagation; when the listing matches a
//      revision this adapter produced earlier (rather than one no device of
//      ours ever made), it's our lag, not another device, so we proceed.

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
  // Aggregate revisions this adapter has itself produced (from `load` and from
  // each successful `save`), newest last and bounded. The pre-save drift check
  // consults it to tell "the backend's listing is still catching up to a write
  // of ours" (a revision we made earlier) from "another device moved the file"
  // (a revision we never made) — see the file header. Bounded because only the
  // most recent few can plausibly be a not-yet-propagated listing.
  const produced: string[] = [];
  const MAX_TRACKED = 12;
  function remember(revision: string): void {
    if (produced[produced.length - 1] === revision) return;
    produced.push(revision);
    if (produced.length > MAX_TRACKED) produced.shift();
  }

  // A rebuild starts `produced` empty, so the first queued back-to-back save
  // after one can't recognise its own lagging write. If this line appears
  // mid-typing-session (not just on connect / namespace switch), the adapter
  // is being recreated under the sync engine and dropping the lag tolerance.
  log.debug(`${options.id}: directory adapter created`);

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
    const revision = aggregateRevision(entries);
    remember(revision);
    log.debug(`${options.id} load: rev=${shortRev(revision)}`);
    return { text, revision };
  }

  async function save(
    text: string,
    baseRevision?: string,
  ): Promise<StoredSnapshot> {
    const before = await store.list();
    const current = aggregateRevision(before);
    log.debug(
      `${options.id} save: base=${shortRev(baseRevision)} listed=${shortRev(current)} match=${current === baseRevision} producedN=${produced.length}`,
    );
    if (baseRevision !== undefined && current !== baseRevision) {
      // A listing that differs from the caller's baseline is a conflict only
      // when it's *not* one of our own recently produced states the backend
      // hasn't finished propagating yet — otherwise a single device collides
      // with itself on a queued back-to-back save (see the file header).
      const tolerated = produced.includes(current);
      // Always captured (no debug toggle needed): this single line is what a
      // phantom-conflict bug report turns on. `tolerated` true means we
      // absorbed our own lagging write; false means the modal is about to show.
      log.warn(
        `${options.id} save: listing diverged from base — ${tolerated ? "tolerated own lag" : "raising CONFLICT"}`,
        {
          base: shortRev(baseRevision),
          listed: shortRev(current),
          tolerated,
          recentlyProduced: produced.slice(-8).map(shortRev),
        },
      );
      if (!tolerated) {
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

    // Collect the per-file revisions the writes report so the post-save
    // aggregate can be built without re-listing. `null` means a backend
    // couldn't report one, forcing the (eventually consistent) list fallback.
    let written: FileEntry[] | null;
    if (isEncryptedEnvelope(text)) {
      // Can't express an envelope as markdown — store it whole and drop any
      // markdown files so the two representations can't disagree.
      const rev = await store.write(BLOB_FILE_NAME, text);
      await Promise.all([...existingMd].map((path) => store.remove(path)));
      written = rev === undefined ? null : [{ path: BLOB_FILE_NAME, rev }];
    } else {
      const files = snapshotToFiles(parse(text));
      const desired = new Set(files.map((f) => f.path));
      const entries = await Promise.all(
        files.map(async (f) => ({
          path: f.path,
          rev: await store.write(f.path, f.text),
        })),
      );
      const removals = [...existingMd].filter((p) => !desired.has(p));
      if (hasBlob) removals.push(BLOB_FILE_NAME);
      await Promise.all(removals.map((path) => store.remove(path)));
      written = entries.every((e) => e.rev !== undefined)
        ? entries.map((e) => ({ path: e.path, rev: e.rev }))
        : null;
    }

    if (written === null) {
      // A backend write reported no revision, so we can't build the post-save
      // revision authoritatively and must re-list — which is eventually
      // consistent and the very thing that reintroduces phantom self-conflicts.
      // Always captured: if this shows up, the backend's write isn't returning
      // its rev (e.g. an unexpected upload-response shape).
      log.warn(
        `${options.id} save: a write returned no revision — falling back to a re-list (lag-prone, may cause phantom conflicts)`,
      );
    }
    const revision = aggregateRevision(written ?? (await store.list()));
    remember(revision);
    log.debug(
      `${options.id} save: committed base=${shortRev(baseRevision)} -> rev=${shortRev(revision)}`,
    );
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
