// The offline-cache miss, in a module of its own.
//
// `UnlockGate` `instanceof`-checks this to tell "wrong passphrase" from "the
// backend is unreachable and there's nothing mirrored yet", and it does so on
// the app's first-paint path. The cache implementation beside it, by contrast,
// is only reachable once a cloud backend is actually connected and is loaded
// on demand with the rest of the remote backends (see `remote-backends.ts`).
// Splitting the error out is what lets the check stay static without dragging
// the mirror in behind it.

export class OfflineUnavailableError extends Error {
  constructor(
    message = "Backend is unreachable and nothing is cached yet",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OfflineUnavailableError";
  }
}
