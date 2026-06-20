import { describe, expect, it } from "vitest";

import {
  AuthError,
  ConflictError,
  type StorageAdapter,
  type StoredSnapshot,
} from "../../src/storage/adapter.ts";
import {
  isOfflineError,
  localCacheKey,
  withLocalCache,
} from "../../src/storage/cache/index.ts";
import {
  BrowserLocalStorageAdapter,
  LOCAL_STORAGE_KEY,
} from "../../src/storage/local/index.ts";

// Minimal in-memory `Storage` stand-in (the test env has no localStorage).
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
  };
}

describe("browser local adapter", () => {
  it("round-trips text under the historical notes/v1 key", async () => {
    const storage = memoryStorage();
    const a = new BrowserLocalStorageAdapter(storage);
    await a.save("hello");
    expect(storage.getItem(LOCAL_STORAGE_KEY)).toBe("hello");
    expect(a.loadSync()?.text).toBe("hello");
    expect((await a.load())?.text).toBe("hello");
  });

  it("loads null when nothing is stored", () => {
    expect(
      new BrowserLocalStorageAdapter(memoryStorage()).loadSync(),
    ).toBeNull();
  });
});

describe("isOfflineError", () => {
  it("is false for the adapter's typed signals", () => {
    expect(isOfflineError(new ConflictError({ text: "" }))).toBe(false);
    expect(isOfflineError(new AuthError("x"))).toBe(false);
  });

  it("is true for a raw fetch network TypeError", () => {
    expect(isOfflineError(new TypeError("Failed to fetch"))).toBe(true);
  });
});

describe("withLocalCache", () => {
  function flakyAdapter(): {
    adapter: StorageAdapter;
    setOffline: (v: boolean) => void;
  } {
    let offline = false;
    let stored: StoredSnapshot | null = null;
    const adapter: StorageAdapter = {
      id: "dropbox",
      label: "Flaky",
      capabilities: new Set(),
      async load() {
        if (offline) throw new TypeError("Failed to fetch");
        return stored;
      },
      async save(text) {
        if (offline) throw new TypeError("Failed to fetch");
        stored = { text, revision: "r1" };
        return stored;
      },
    };
    return { adapter, setOffline: (v) => (offline = v) };
  }

  it("serves the cached copy (flagged offline) when the backend is unreachable", async () => {
    const storage = memoryStorage();
    const { adapter, setOffline } = flakyAdapter();
    const cached = withLocalCache(adapter, {
      storage,
      key: localCacheKey("dropbox"),
    });
    await cached.save("v1");
    setOffline(true);
    const snap = await cached.load();
    expect(snap?.text).toBe("v1");
    expect(snap?.offline).toBe(true);
  });

  it("persists an offline save locally and re-throws so the engine retries", async () => {
    const storage = memoryStorage();
    const { adapter, setOffline } = flakyAdapter();
    const cached = withLocalCache(adapter, {
      storage,
      key: localCacheKey("dropbox"),
    });
    setOffline(true);
    await expect(cached.save("queued")).rejects.toBeInstanceOf(TypeError);
    expect(storage.getItem(localCacheKey("dropbox"))).toContain("queued");
  });
});

describe("withLocalCache — sealed mirror (encryption on)", () => {
  // A realistic seal: wrap plaintext in the whole-document envelope so the
  // mirror in localStorage is ciphertext, exactly as the app does when
  // encryption is active and the per-file adapter hands the cache plaintext.
  function sealed() {
    let stored: StoredSnapshot | null = null;
    let offline = false;
    const inner: StorageAdapter = {
      id: "dropbox",
      label: "Sealed",
      capabilities: new Set(),
      async load() {
        if (offline) throw new TypeError("Failed to fetch");
        return stored;
      },
      async save(text) {
        if (offline) throw new TypeError("Failed to fetch");
        stored = { text, revision: "r1" };
        return stored;
      },
    };
    return { inner, setOffline: (v: boolean) => (offline = v) };
  }

  it("never writes plaintext to localStorage and unseals on offline read", async () => {
    const { encryptText, decryptEnvelope, isEncryptedEnvelope } =
      await import("../../src/storage/crypto.ts");
    const storage = memoryStorage();
    const { inner, setOffline } = sealed();
    const cache = withLocalCache(inner, {
      storage,
      key: localCacheKey("dropbox"),
      seal: (t) => encryptText(t, "pw"),
      unseal: (t) => decryptEnvelope(t, "pw"),
    });

    const secret = JSON.stringify({ notes: [{ id: "a", body: "TOPSECRET" }] });
    await cache.save(secret);

    // The mirror holds an envelope, not the plaintext.
    const raw = storage.getItem(localCacheKey("dropbox"))!;
    expect(raw).not.toContain("TOPSECRET");
    const envelope = JSON.parse(raw).text as string;
    expect(isEncryptedEnvelope(envelope)).toBe(true);

    // Offline read transparently unseals back to plaintext.
    setOffline(true);
    const snap = await cache.load();
    expect(snap?.text).toBe(secret);
    expect(snap?.offline).toBe(true);
  });
});
