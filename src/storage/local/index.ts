// Default storage backend: a single JSON document in localStorage. Speaks
// bytes through the `StorageAdapter` contract (see ../adapter.ts) — the
// serialize / parse pipeline lives in ../serialize.ts, so this adapter only
// moves text in and out of a `Storage`. The Storage object is injectable so
// tests run against an in-memory stub instead of the real `localStorage`.
//
// The document lives under the historical `notes/v1` key, so data written by
// the original (pre-backend) localStorage layer is read back unchanged.

import type { StorageAdapter, StoredSnapshot } from "../adapter.ts";

// The single key the document is stored under. Matches the key the original
// `loadNotes` / `saveNotes` pair used, so existing notes survive the upgrade.
export const LOCAL_STORAGE_KEY = "notes/v1";

export class BrowserLocalStorageAdapter implements StorageAdapter {
  readonly id = "browser" as const;
  readonly label = "This device";
  readonly capabilities: ReadonlySet<"loadSync"> = new Set(["loadSync"]);

  constructor(private readonly storage: Storage = globalThis.localStorage) {}

  loadSync(): StoredSnapshot | null {
    const text = this.read();
    return text === null ? null : { text };
  }

  async load(): Promise<StoredSnapshot | null> {
    return this.loadSync();
  }

  async save(text: string): Promise<StoredSnapshot> {
    this.storage.setItem(LOCAL_STORAGE_KEY, text);
    return { text };
  }

  private read(): string | null {
    try {
      return this.storage.getItem(LOCAL_STORAGE_KEY);
    } catch {
      // disabled / blocked storage — treat as "no data"
      return null;
    }
  }
}
