// The single code-splitting boundary for every backend that isn't this
// browser's `localStorage`.
//
// Dropbox, Google Drive, the picked folder, and notesd together are the
// largest block of code most people never execute: the app opens on the
// browser backend and stays there unless someone deliberately connects
// something. This module exists so all four — and the directory adapter and
// offline-cache mirror they share — sit behind one `import()` rather than
// being reachable from the seven hooks that use them.
//
// **It must have no static importers.** A single static `import` of this
// module folds the whole family back into the first paint and the split
// silently stops paying. The hooks reach it through `useRemoteBackends` (the
// render path) or a local `await import()` (verbs that run on a gesture). It
// re-exports rather than re-implements, so each backend keeps its own home and
// its historical import path still works for tests.

export { localCacheKey, withLocalCache } from "./cache/index.ts";
export {
  createDropboxAdapter,
  createDropboxNamespaceStore,
  createDropboxSettingsStore,
  deleteDropboxNamespace,
} from "./dropbox/index.ts";
export {
  createGdriveAdapter,
  createGdriveNamespaceStore,
  createGdriveSettingsStore,
  deleteGdriveNamespace,
} from "./gdrive/index.ts";
export {
  createFolderAdapter,
  createFolderNamespaceStore,
  createFolderSettingsStore,
} from "./folder/index.ts";
export {
  createNotesdAdapter,
  createNotesdNamespaceStore,
  createNotesdSettingsStore,
  deleteNotesdNamespace,
} from "./notesd/index.ts";

/** Everything the storage seam needs once a remote backend is in play. */
export type RemoteBackends = typeof import("./remote-backends.ts");
