// Pins the higher-order-wrapper capability contract documented in
// `adapter.ts`: `withLocalCache` adds `loadSync`, `withEncryption` removes it,
// and — the invariant most likely to be got wrong later — the composition
// order that decides whether a combined stack keeps `loadSync`.

import { describe, expect, it } from "vitest";

import type {
  StorageAdapter,
  StoredSnapshot,
} from "../../src/storage/adapter.ts";
import {
  localCacheKey,
  withLocalCache,
} from "../../src/storage/cache/index.ts";
import { withEncryption } from "../../src/storage/encrypting/index.ts";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  } as Storage;
}

// A cloud-shaped inner adapter that advertises a rich capability set — crucially
// including `loadSync`, so the wrappers' effect on it is observable.
function innerAdapter(): StorageAdapter {
  let stored: StoredSnapshot | null = null;
  return {
    id: "dropbox",
    label: "Inner",
    capabilities: new Set(["loadSync", "watch", "attachments"]),
    async load() {
      return stored;
    },
    async save(text: string) {
      stored = { text };
      return stored;
    },
  };
}

function cache(inner: StorageAdapter): StorageAdapter {
  return withLocalCache(inner, {
    storage: memoryStorage(),
    key: localCacheKey("dropbox"),
  });
}

const passthrough = { current: null };

describe("wrapper capability contract", () => {
  it("withEncryption removes loadSync but forwards the rest", () => {
    const enc = withEncryption(innerAdapter(), passthrough);
    expect(enc.capabilities.has("loadSync")).toBe(false);
    expect(enc.capabilities.has("watch")).toBe(true);
    expect(enc.capabilities.has("attachments")).toBe(true);
  });

  it("withLocalCache adds loadSync on top of the inner set", () => {
    // Start from an inner without loadSync to prove the cache is the source.
    const bare: StorageAdapter = { ...innerAdapter(), capabilities: new Set() };
    expect(cache(bare).capabilities.has("loadSync")).toBe(true);
  });

  it("keeps loadSync only when the cache sits outside encryption", () => {
    // cache(encryption(inner)) — cache is outermost, so its loadSync survives.
    const cacheOutside = cache(withEncryption(innerAdapter(), passthrough));
    expect(cacheOutside.capabilities.has("loadSync")).toBe(true);

    // encryption(cache(inner)) — encryption is outermost, so it strips the
    // loadSync the cache added. This is the invalid order for a sync fast path.
    const encryptionOutside = withEncryption(
      cache(innerAdapter()),
      passthrough,
    );
    expect(encryptionOutside.capabilities.has("loadSync")).toBe(false);
  });
});
