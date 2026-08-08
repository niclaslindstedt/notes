// The `sessionStorage` key holding the in-flight PKCE verifier, shared rather
// than duplicated: the adapter (`./index.ts`) writes and reads it, while
// `./pending.ts` probes it on every boot without loading the adapter. A copy
// in each would be one rename away from a silently broken OAuth round-trip.
//
// `sessionStorage` survives the OAuth redirect round-trip but is scoped to the
// tab, so a parallel auth flow in another tab can't race with this.
export const PKCE_VERIFIER_KEY = "notes:dropbox:pkce:verifier";
