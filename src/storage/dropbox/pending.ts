// Whether a Dropbox OAuth redirect is waiting to be completed.
//
// The boot effect in `useCloudBackend` asks this on every start, so it has to
// answer without loading anything: the rest of the Dropbox backend is fetched
// on demand (see `remote-backends.ts`), and pulling the adapter in just to
// read one `sessionStorage` key would put it straight back into the first
// paint.

import { PKCE_VERIFIER_KEY } from "./pkce-key.ts";

export function hasPendingDropboxAuth(): boolean {
  return sessionStorage.getItem(PKCE_VERIFIER_KEY) !== null;
}
