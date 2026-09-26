// THE APP <-> iCLOUD DRIVE SEAM, JavaScript side.
//
// The whole native surface this module adds is a small file store: list,
// read, write, remove, inside the app's own iCloud Drive container. iCloud
// does the syncing; nothing here merges, diffs, or interprets a byte. The web
// app drives it through its own directory adapter, the same way it drives a
// picked local folder or Dropbox — which is also where the notes are sealed
// when encryption is on, so this module only ever moves what it is handed.
//
// APPLE ONLY. iCloud has no Android equivalent, so the module declares only
// the `ios` platform and `requireOptionalNativeModule` returns `null`
// everywhere else — an Android build, Expo Go, a bare `expo start`. The
// wrapper then reports the backend as unavailable and the web app hides it,
// rather than crashing at import.

import { requireOptionalNativeModule } from "expo";

/**
 * The iCloud container the notes sync through.
 *
 * Changing this after release strands every synced copy — the app starts
 * reading a container nothing has ever written, and the user's notes look
 * gone (they are not; they are in the old container). It is pinned in three
 * places that must agree: here, `ios/ICloudStoreModule.swift`, and
 * `app.config.js` (the entitlements and the Files-app declaration). The root
 * test suite checks that they do.
 */
export const ICLOUD_CONTAINER = "iCloud.se.agilator.notes";

/** One file in the container, as the native side reports it. */
export type ICloudNativeEntry = {
  /** Path relative to the container's `Documents` folder, `/`-separated. */
  path: string;
  /** Opaque token that changes when the bytes change (modification time and
   *  size). Never interpreted — the directory adapter only compares it. */
  rev: string;
};

export type ICloudStoreNativeModule = {
  /** Whether the container is reachable: `true` once the ubiquity container
   *  has resolved, `false` when the device has no iCloud account or iCloud
   *  Drive is off. */
  isAvailable(): Promise<boolean>;
  /** Every file under the container's `Documents` folder, recursively. */
  list(): Promise<ICloudNativeEntry[]>;
  /** One file's contents as UTF-8 text, or `null` when it does not exist. */
  readText(path: string): Promise<string | null>;
  /** Write (create or overwrite) one file from UTF-8 text. */
  writeText(path: string, text: string): Promise<void>;
  /** One file's contents as base64, or `null` when it does not exist. */
  readBytes(path: string): Promise<string | null>;
  /** Write (create or overwrite) one file from base64. */
  writeBytes(path: string, base64: string): Promise<void>;
  /** Delete one file. A missing file is treated as already gone. */
  remove(path: string): Promise<void>;
};

/** The native module, or `null` in a build that does not carry it. */
export const ICloudStore =
  requireOptionalNativeModule<ICloudStoreNativeModule>("ICloudStore");

export default ICloudStore;
