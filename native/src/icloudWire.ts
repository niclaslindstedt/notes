// WHAT CROSSES THE iCLOUD BRIDGE — the shapes, and nothing that can reach
// iCloud.
//
// This module exists to stay IMPORT-FREE, and that is its whole job. The root
// `tsc` type-checks `tests/`, `tests/platform/icloud-host.test.ts` imports
// `icloudBridge.ts`, and a root `npm ci` does not install `native/`'s own
// dependencies — so anything reachable from that test which imports
// `expo-modules-core` turns a fully-installed machine green and CI red.
//
// So `icloudBridge.ts` — pure, and exercised from the root suite — takes its
// types from here, and only `icloud.ts` reaches for the native module. Nothing
// in the root's type graph reaches it at all.
//
// The types below MIRROR `src/platform/icloud-host.ts`'s rather than importing
// them: `native/` is a separate npm project and reaching across would make the
// wrapper's typecheck depend on the web app's module resolution. The root test
// is what keeps the two honest.

/** Whether the container can be used right now.
 *
 *  `unavailable` is the website and every Android build — nothing offers
 *  iCloud there, and it is what hides the backend from the picker.
 *  `signed-out` is an iPhone with no iCloud account (or iCloud Drive turned
 *  off), which is a state the user can fix, so it is worth telling them
 *  apart. */
export type ICloudStatus = "ready" | "signed-out" | "unavailable";

/** One file in the container: its path relative to the container's `Documents`
 *  folder, plus an opaque token that changes when the bytes change. Mirrors the
 *  web app's `FileEntry`. */
export type ICloudEntry = { path: string; rev?: string };

/** What the provider's methods resolve to. A failure crosses as data rather
 *  than as a rejected promise, because the bridge is a message channel: the
 *  page-side script turns `ok: false` back into a thrown `Error` so the app's
 *  sync engine sees an ordinary failure and surfaces its usual fault. */
export type ICloudResult<T> =
  { ok: true; value: T } | { ok: false; error: string };
