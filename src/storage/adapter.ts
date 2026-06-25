// Storage backend contract. The app talks to a `StorageAdapter` instead of
// touching `localStorage` directly so cloud and local-folder backends slot
// in behind the same interface without the UI or app-state layer changing.
//
// Adapters speak bytes, not domain values: serialize / parse / migrate live
// in `./serialize.ts` and run on every load and save regardless of which
// backend is active. That keeps each adapter small and stops a backend from
// bypassing the parse pipeline.

import type { Note } from "../domain/note.ts";

/** A document's bytes plus the metadata a backend needs to stay coherent. */
export type StoredSnapshot = {
  // The serialized document JSON, exactly as produced by `serialize` in
  // `./serialize.ts`.
  text: string;

  // Opaque, adapter-defined token used for optimistic concurrency. Dropbox
  // returns a `rev`, Drive a version, a folder's aggregate mtime works too.
  // The caller hands it back unchanged on the next save so the adapter can
  // refuse to overwrite a newer remote revision. Local backends leave it
  // undefined — nothing else writes the same key.
  revision?: string;

  // Set by adapters that can serve cached bytes when the live backend is
  // unreachable. Lets the UI tell the user they're editing a local copy.
  // The local backends never set it.
  offline?: boolean;
};

// Optional-feature tags advertised by each adapter so UI surfaces can gate
// on capability rather than `adapter.foo !== undefined` checks.
export type AdapterCapability =
  // `loadSync()` is implemented — bytes can be served before first paint.
  | "loadSync"
  // `watch()` is implemented — adapter delivers out-of-band change events.
  | "watch"
  // `getRevision()` is implemented — the current revision token can be
  // fetched without downloading the full body.
  | "getRevision"
  // The backend stores image attachments as files (a folder / cloud backend).
  // The editor gates paste / drop of images on this so the local browser
  // backend, which has nowhere to put a file, doesn't accept them.
  | "attachments";

// A single step within converting one note's at-rest representation, surfaced
// so the UI can flash exactly which note — and which of that note's
// attachments — is being sealed or unsealed right now. `note` is the note file
// itself; `attachment` is one of its pasted images / files.
export type NoteConversionStep =
  | { phase: "note" }
  | { phase: "attachment"; filename: string };

export type NoteConversionProgress = (step: NoteConversionStep) => void;

// Per-note at-rest encryption status from the last load: "encrypted" once a
// note and all its attachments are sealed, "pending" while an in-progress
// migration still has a plaintext remnant. Drives the green lock in the UI.
export type NoteEncStatus = "encrypted" | "pending";

export type StorageAdapter = {
  // Stable identifier so device-local settings (auth tokens, last-used
  // adapter) can be keyed per backend.
  readonly id: "browser" | "folder" | "dropbox" | "gdrive";

  // Human-readable label for the settings UI.
  readonly label: string;

  // Optional-feature tags this adapter supports. UI gates on
  // `capabilities.has("watch")` rather than `Boolean(adapter.watch)` so a
  // new backend slots in by editing one set.
  readonly capabilities: ReadonlySet<AdapterCapability>;

  // Optional synchronous fast path. localStorage can return data before the
  // first paint; cloud adapters cannot. Implementing this avoids a one-frame
  // empty-list flash on mount. Present iff `capabilities` carries
  // `"loadSync"`.
  loadSync?(): StoredSnapshot | null;

  // Load the current snapshot. Returns null when nothing has been stored yet
  // (first run, or an empty cloud app folder).
  //
  // `previous` is an optional hint: the snapshot the caller last held for this
  // backend (e.g. the offline cache). A file-per-note backend uses it to skip
  // re-downloading notes whose revision hasn't moved — it lists cheaply, then
  // fetches only the files that changed. Adapters that can't exploit it ignore
  // the argument and load in full; passing it can never change the result, only
  // how much is fetched.
  load(previous?: StoredSnapshot): Promise<StoredSnapshot | null>;

  // Save the snapshot. If `baseRevision` is provided and the remote has
  // moved beyond it, the adapter must throw `ConflictError` carrying the
  // newer snapshot. Local adapters can ignore the argument.
  save(text: string, baseRevision?: string): Promise<StoredSnapshot>;

  // Optional cheap "what's the current remote revision?" probe. Returns the
  // same opaque token `load()` / `save()` put on `StoredSnapshot.revision`,
  // or null when nothing is stored yet. Present iff `capabilities` carries
  // `"getRevision"`.
  getRevision?(): Promise<string | null>;

  // Optional subscription to out-of-band remote changes; returns an
  // unsubscribe function. Present iff `capabilities` carries `"watch"`.
  watch?(onRemoteChange: (snapshot: StoredSnapshot) => void): () => void;

  // Optional on-demand fetch of one attachment's bytes, so the note list can
  // load without pulling every note's images and a note's attachments are read
  // only when it is opened. Returns null when the attachment isn't found or the
  // backend has no attachment store. File backends implement this.
  fetchAttachment?(
    note: Note,
    filename: string,
  ): Promise<{ mime: string; bytes: Uint8Array } | null>;

  // Optional on-demand fetch of one note's body, the lazy counterpart of the
  // encrypted index load: an encrypted vault unlocks by rendering the list from
  // a small encrypted index with every body deferred, then this decrypts a
  // single note's `.enc` when it is opened. Returns
  // the body text, or null when the backend doesn't defer bodies (the body is
  // already loaded) or the note file is missing. Only the encrypted file
  // backends implement it.
  fetchNoteBody?(note: Note): Promise<string | null>;

  // Per-note at-rest encryption status from the last load — "encrypted" once a
  // note and all its attachments are sealed, "pending" while an in-progress
  // migration still has a plaintext remnant. Drives the green lock. Empty/absent
  // when encryption is off.
  getEncryptionStatus?(): Map<string, NoteEncStatus>;

  // Rebuild + seal the encrypted note index from the given snapshot, best-effort.
  // Called once the background encryption migration finishes so the first unlock
  // afterwards renders from the index instead of decrypting every note in the
  // per-file fallback — the migration seals notes one at a time without touching
  // the index, so it would otherwise stay absent until the next regular save. A
  // no-op when the backend doesn't keep an index or encryption is off. Only the
  // encrypted file backends implement it.
  refreshIndex?(notes: readonly Note[]): Promise<void>;

  // Convert one note from plaintext to its encrypted per-file form, atomically
  // and idempotently. The paced migration queue calls this per note so a large
  // conversion doesn't burst the cloud API. `onStep` fires as each of the note's
  // attachments and then the note file itself is sealed, so the UI can flash
  // what it's working on. Returns true when work was done.
  migrateNote?(note: Note, onStep?: NoteConversionProgress): Promise<boolean>;

  // The exact reverse of `migrateNote`: convert one note from its encrypted
  // per-file form back to plaintext markdown + plaintext attachment files,
  // atomically and idempotently. Drives the background de-encryption queue when
  // the user turns encryption off, so disabling never bursts the cloud API
  // either. `onStep` mirrors `migrateNote`'s. Returns true when work was done.
  demigrateNote?(note: Note, onStep?: NoteConversionProgress): Promise<boolean>;

  // One-time upgrade of a legacy whole-document `notes.json` envelope to the
  // per-file encrypted form, atomically. Idempotent (no-op once split). Returns
  // true when it performed the split.
  splitLegacyBlob?(): Promise<boolean>;

  // Optional subscription to per-note upload progress: the set of note ids whose
  // file is currently being written to the backend. The adapter emits the full
  // current set each time it changes, and once immediately on subscribe.
  // Drives the per-note sync spinner in the note list and side menu. The
  // file-per-note backends implement it (the upload is one `store.write` per
  // changed note); the local browser backend, which writes one synchronous
  // blob, does not. Returns an unsubscribe function.
  watchUploads?(listener: (uploading: ReadonlySet<string>) => void): () => void;

  // Milliseconds to wait after the last edit before pushing a save. Defaults
  // to 0 (save immediately) — right for localStorage. Cloud adapters set
  // this around a second to coalesce keystrokes into one request.
  readonly saveDebounceMs?: number;
};

export class ConflictError extends Error {
  constructor(readonly remote: StoredSnapshot) {
    super("Remote revision moved");
    this.name = "ConflictError";
  }
}

// Thrown by cloud adapters when an HTTP 401 surfaces after any silent
// refresh has already been attempted (Dropbox) or when the access token has
// expired with no refresh path (Google Drive — GIS popup tokens are
// short-lived and don't ship a refresh token). The UI turns this into a
// "Reconnect" affordance instead of a generic "Try again".
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

// Thrown by cloud adapters when the backend rate-limits a write (HTTP 429).
// Carries the cooldown the backend asked for (or a sensible floor) so the
// caller can back off and retry rather than surfacing a hard error.
export class RateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`Rate limited; retry after ${retryAfterMs}ms`);
    this.name = "RateLimitError";
  }
}
