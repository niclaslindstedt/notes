// The iOS-only iCloud backend: the React Native counterpart of the web app's
// cloud adapters, but backed by Apple's iCloud key-value store
// (NSUbiquitousKeyValueStore) instead of an HTTP API. It speaks the exact
// same StorageAdapter contract as AsyncStorageAdapter — opaque bytes in and
// out — so the shared serialize / parse / migration pipeline and the
// `useNotes` hook drive it unchanged.
//
// Why key-value and not iCloud Documents: a notes document is small (well
// within the 1 MB per-key / ~64 KB-per-value envelope KVS allows for a JSON
// blob of this size) and the store syncs itself across the user's devices
// with no OAuth, no tokens, and no network code of our own. That keeps the
// adapter to the same getItem/setItem shape as the local one.
//
// Unlike AsyncStorage this backend is *shared* across a person's devices, so
// it advertises the `watch` capability: when another device pushes an edit,
// iCloud fires `onStoreDidChange` and we re-read our key and hand the fresh
// snapshot back to the caller (App wires that to `reload`). It does NOT
// advertise `loadSync` (the native bridge has no synchronous read) — the same
// as AsyncStorageAdapter, and `useNotesSync` already tolerates that.
//
// This module must only be imported on iOS: the native iCloud module is not
// present on Android/web. `native/src/storage/backends.ts` gates it behind
// `Platform.OS === "ios"`, so the import is never evaluated elsewhere.

import iCloudStorage from "react-native-icloudstore";

import type {
  AdapterCapability,
  StorageAdapter,
  StoredSnapshot,
} from "../../../src/storage/adapter.ts";
import {
  DEFAULT_NAMESPACE_SLUG,
  namespaceLocalKey,
} from "../../../src/storage/namespaces.ts";

export class ICloudStorageAdapter implements StorageAdapter {
  // The notes adapter contract has no dedicated "icloud" id (its union is
  // browser / folder / dropbox / gdrive), so reuse "browser": to the shared
  // app-state layer this is still a device-reachable default backend, and the
  // native picker tracks the iCloud-vs-on-device choice separately through its
  // own `NativeBackendId` (see ./backends.ts). Keeping the id avoids widening
  // the shared contract just for the native app.
  readonly id = "browser" as const;
  readonly label = "iCloud";
  readonly capabilities: ReadonlySet<AdapterCapability> = new Set(["watch"]);
  // iCloud's setItem writes to the local KVS cache immediately and syncs in
  // the background, so it is cheap — but coalesce a burst of keystrokes into
  // one write the way the web cloud adapters do rather than saving on every
  // edit. A short window keeps cross-device latency low without thrashing.
  readonly saveDebounceMs = 800;

  // Reuse the local key scheme: the document lives under the same per-
  // namespace key as on-device, just in the iCloud store rather than
  // AsyncStorage. iCloud KVS is a flat string→string map, so there is no
  // folder layout to mirror the web cloud adapters' per-namespace folders.
  private readonly key: string;

  constructor(namespace: string = DEFAULT_NAMESPACE_SLUG) {
    this.key = namespaceLocalKey(namespace);
  }

  async load(): Promise<StoredSnapshot | null> {
    try {
      const text = await iCloudStorage.getItem(this.key);
      return text === null || text === undefined ? null : { text };
    } catch {
      // Treat an unreadable store (iCloud signed out, container not yet
      // provisioned) as "no data" — the parse pipeline maps that to an
      // empty document rather than crashing the load.
      return null;
    }
  }

  async save(text: string): Promise<StoredSnapshot> {
    await iCloudStorage.setItem(this.key, text);
    return { text };
  }

  // iCloud pushes remote edits as `onStoreDidChange` events. Re-read our key
  // when one names it (or names nothing — older module versions omit the
  // changed-key list) and deliver the fresh snapshot. Errors reading back are
  // swallowed: a transient read failure shouldn't tear down the subscription.
  watch(onRemoteChange: (snapshot: StoredSnapshot) => void): () => void {
    const subscription = iCloudStorage.onStoreDidChange((change) => {
      const keys = change?.changedKeys;
      if (keys && keys.length > 0 && !keys.includes(this.key)) return;
      void this.load().then((snapshot) => {
        if (snapshot) onRemoteChange(snapshot);
      });
    });
    return () => subscription.remove();
  }
}
