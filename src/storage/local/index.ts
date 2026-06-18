// Default storage backend: a single JSON document in localStorage. Speaks
// bytes through the `StorageAdapter` contract (see ../adapter.ts) — the
// serialize / parse pipeline lives in ../serialize.ts, so this adapter only
// moves text in and out of a `Storage`. The Storage object is injectable so
// tests run against an in-memory stub instead of the real `localStorage`.
//
// Each namespace gets its own key (see `namespaceLocalKey`). The default
// namespace keeps the historical `notes/v1` key so data written before
// namespaces existed is read back unchanged; other namespaces are keyed
// `notes/v1:<slug>`. The local backend has no folders, so namespacing here
// is purely a key change — there is nothing to relocate.

import type { StorageAdapter, StoredSnapshot } from "../adapter.ts";
import { DEFAULT_NAMESPACE_SLUG, namespaceLocalKey } from "../namespaces.ts";

// The key the default namespace's document is stored under. Matches the key
// the original `loadNotes` / `saveNotes` pair used, so existing notes survive
// the upgrade.
export const LOCAL_STORAGE_KEY = namespaceLocalKey(DEFAULT_NAMESPACE_SLUG);

export class BrowserLocalStorageAdapter implements StorageAdapter {
  readonly id = "browser" as const;
  readonly label = "This device";
  readonly capabilities: ReadonlySet<"loadSync"> = new Set(["loadSync"]);

  private readonly key: string;

  constructor(
    private readonly storage: Storage = globalThis.localStorage,
    namespace: string = DEFAULT_NAMESPACE_SLUG,
  ) {
    this.key = namespaceLocalKey(namespace);
  }

  loadSync(): StoredSnapshot | null {
    const text = this.read();
    return text === null ? null : { text };
  }

  async load(): Promise<StoredSnapshot | null> {
    return this.loadSync();
  }

  async save(text: string): Promise<StoredSnapshot> {
    this.storage.setItem(this.key, text);
    return { text };
  }

  private read(): string | null {
    try {
      return this.storage.getItem(this.key);
    } catch {
      // disabled / blocked storage — treat as "no data"
      return null;
    }
  }
}

/**
 * Delete a namespace's local document. Best-effort: a blocked / disabled
 * `Storage` is treated as "nothing to remove". Used when a namespace is
 * deleted while the local backend is active.
 */
export function deleteLocalNamespace(
  namespace: string,
  storage: Storage = globalThis.localStorage,
): void {
  try {
    storage.removeItem(namespaceLocalKey(namespace));
  } catch {
    // best-effort
  }
}
