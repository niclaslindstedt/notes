// Minimal ambient types for `react-native-icloudstore`, which ships no
// declarations of its own. The package exposes an AsyncStorage-compatible
// default export backed by Apple's iCloud key-value store
// (NSUbiquitousKeyValueStore), plus an `onStoreDidChange` subscription that
// fires when another device pushes a change. We only type the slice the
// iCloud adapter uses; widen this if it grows new call sites.

declare module "react-native-icloudstore" {
  /** Payload delivered to an `onStoreDidChange` listener. */
  export interface ICloudStoreChange {
    /** The keys iCloud reported as changed in this remote update. */
    changedKeys?: string[];
  }

  /** Unsubscribe handle returned by `onStoreDidChange`. */
  export interface ICloudStoreSubscription {
    remove(): void;
  }

  interface ICloudStorageStatic {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
    getAllKeys(): Promise<string[]>;
    onStoreDidChange(
      listener: (change: ICloudStoreChange) => void,
    ): ICloudStoreSubscription;
  }

  const iCloudStorage: ICloudStorageStatic;
  export default iCloudStorage;
}
