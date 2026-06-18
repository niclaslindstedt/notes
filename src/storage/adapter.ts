// Storage backend contract. The app talks to a `StorageAdapter` instead of
// touching `localStorage` directly so cloud and local-folder backends slot
// in behind the same interface without the UI or app-state layer changing.
//
// Adapters speak bytes, not domain values: serialize / parse / migrate live
// in `./serialize.ts` and run on every load and save regardless of which
// backend is active. That keeps each adapter small and stops a backend from
// bypassing the parse pipeline.

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
  | "getRevision";

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
  load(): Promise<StoredSnapshot | null>;

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
