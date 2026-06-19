// The React Native local backend: the on-device counterpart of the web
// app's BrowserLocalStorageAdapter (../../../src/storage/local). It speaks
// the exact same StorageAdapter contract — opaque bytes in and out — so the
// shared serialize / parse / migration pipeline and the `useNotes` hook
// drive it unchanged. The only difference from the browser adapter is the
// substrate: AsyncStorage instead of `localStorage`.
//
// AsyncStorage has no synchronous read, so this adapter does NOT advertise
// the `loadSync` capability. `useNotesSync` already tolerates that — it seeds
// an empty document on first paint and fills it from `load()` in its mount
// effect — so there is no behavioural gap, just no pre-paint data.

import AsyncStorage from "@react-native-async-storage/async-storage";

import type {
  AdapterCapability,
  StorageAdapter,
  StoredSnapshot,
} from "../../../src/storage/adapter.ts";
import {
  DEFAULT_NAMESPACE_SLUG,
  namespaceLocalKey,
} from "../../../src/storage/namespaces.ts";

export class AsyncStorageAdapter implements StorageAdapter {
  // Reuse the "browser" id: from the app-state layer's point of view this
  // is the same thing — the device-local default backend — and keeping the
  // id avoids widening the adapter id union in the shared contract.
  readonly id = "browser" as const;
  readonly label = "This device";
  readonly capabilities: ReadonlySet<AdapterCapability> = new Set();
  // AsyncStorage writes are cheap; save on every edit like the browser
  // backend rather than coalescing.
  readonly saveDebounceMs = 0;

  private readonly key: string;

  constructor(namespace: string = DEFAULT_NAMESPACE_SLUG) {
    this.key = namespaceLocalKey(namespace);
  }

  async load(): Promise<StoredSnapshot | null> {
    try {
      const text = await AsyncStorage.getItem(this.key);
      return text === null ? null : { text };
    } catch {
      // Treat an unreadable store as "no data" — the parse pipeline maps
      // that to an empty document rather than crashing the load.
      return null;
    }
  }

  async save(text: string): Promise<StoredSnapshot> {
    await AsyncStorage.setItem(this.key, text);
    return { text };
  }
}
