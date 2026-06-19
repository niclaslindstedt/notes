// The native app's storage-backend registry — the on-device analogue of the
// web app's backend picker (Settings → Storage). It lists the backends a
// person can choose from *on this platform* and knows how to build each one.
//
// The whole point of this file is the platform gate: the iCloud backend only
// exists on iOS, so it is the single place that decides whether to offer it.
// On Android and web, `availableBackends()` returns just the on-device
// backend, so the picker has nothing extra to show and the iCloud adapter
// module — which pulls in a native iOS-only dependency — is never required.

import { Platform } from "react-native";

import type { StorageAdapter } from "../../../src/storage/adapter.ts";

import { AsyncStorageAdapter } from "./asyncStorageAdapter.ts";

/** Stable id for a native backend choice, persisted per device. */
export type NativeBackendId = "browser" | "icloud";

export const DEFAULT_BACKEND_ID: NativeBackendId = "browser";

export interface BackendOption {
  /** Persisted identifier (see `backendPreference.ts`). */
  readonly id: NativeBackendId;
  /** Human-readable label for the picker. */
  readonly label: string;
  /** Build a fresh adapter instance for the given namespace. */
  create(namespace?: string): StorageAdapter;
}

const browserBackend: BackendOption = {
  id: "browser",
  label: "This device",
  create: (namespace) => new AsyncStorageAdapter(namespace),
};

const icloudBackend: BackendOption = {
  id: "icloud",
  label: "iCloud",
  // Required lazily so the iOS-only native module behind the adapter is never
  // loaded on Android/web, where this branch is unreachable.
  create: (namespace) => {
    const { ICloudStorageAdapter } =
      require("./icloudStorageAdapter.ts") as typeof import("./icloudStorageAdapter.ts");
    return new ICloudStorageAdapter(namespace);
  },
};

/**
 * The backends offered on this device. Always includes the on-device
 * default; iCloud is appended only on iOS. When the list has a single entry
 * the UI has no meaningful choice to present, which is exactly how the
 * picker stays hidden everywhere except iOS.
 */
export function availableBackends(): BackendOption[] {
  return Platform.OS === "ios"
    ? [browserBackend, icloudBackend]
    : [browserBackend];
}

/** Look up a backend by id, falling back to the on-device default. */
export function backendById(id: NativeBackendId): BackendOption {
  return availableBackends().find((b) => b.id === id) ?? browserBackend;
}
