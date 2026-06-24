import { describe, expect, it, vi } from "vitest";

import {
  KEY_PARAMS_FILE,
  createCryptoSession,
} from "../../src/storage/crypto-session.ts";
import type { FileEntry, FileStore } from "../../src/storage/file-store.ts";

type MemFile = { text: string; rev: number };

// A minimal in-memory FileStore that counts reads/writes so a test can assert
// the session derives keys / reads the key-params file at most once per session.
function memoryStore(files = new Map<string, MemFile>()) {
  let counter = 0;
  const reads: string[] = [];
  const writes: string[] = [];
  const store: FileStore & {
    files: Map<string, MemFile>;
    reads: string[];
    writes: string[];
  } = {
    files,
    reads,
    writes,
    async list(): Promise<FileEntry[]> {
      return [...files.entries()].map(([path, { rev }]) => ({
        path,
        rev: String(rev),
      }));
    },
    async read(path) {
      reads.push(path);
      return files.get(path)?.text ?? null;
    },
    async write(path, text) {
      writes.push(path);
      const rev = ++counter;
      files.set(path, { text, rev });
      return String(rev);
    },
    async remove(path) {
      files.delete(path);
    },
  };
  return store;
}

describe("createCryptoSession", () => {
  it("returns null and writes nothing when no passphrase is held", async () => {
    const store = memoryStore();
    const session = createCryptoSession({
      store,
      passwordRef: { current: null },
    });

    expect(await session.ensureKeys()).toBeNull();
    expect(store.writes).toEqual([]);
    expect(store.files.has(KEY_PARAMS_FILE)).toBe(false);
  });

  it("derives keys and creates the key-params file on first unlock", async () => {
    const store = memoryStore();
    const session = createCryptoSession({
      store,
      passwordRef: { current: "hunter2" },
    });

    const keys = await session.ensureKeys();
    expect(keys).not.toBeNull();
    expect(keys?.contentKey).toBeInstanceOf(CryptoKey);
    expect(keys?.fileKey).toBeInstanceOf(CryptoKey);
    // The salts file is created once so every device shares the same KDF params.
    expect(store.files.has(KEY_PARAMS_FILE)).toBe(true);
    expect(store.writes).toEqual([KEY_PARAMS_FILE]);
  });

  it("caches keys for an unchanged passphrase — no re-read, no rewrite", async () => {
    const store = memoryStore();
    const session = createCryptoSession({
      store,
      passwordRef: { current: "hunter2" },
    });

    const first = await session.ensureKeys();
    const readsAfterFirst = store.reads.length;
    const second = await session.ensureKeys();

    // Same derived-key object, and the second call touched the store at all.
    expect(second).toBe(first);
    expect(store.reads.length).toBe(readsAfterFirst);
    expect(store.writes).toEqual([KEY_PARAMS_FILE]);
  });

  it("reuses the existing key-params file rather than rewriting it", async () => {
    const files = new Map<string, MemFile>();
    const storeA = memoryStore(files);
    // First session creates the params.
    await createCryptoSession({
      store: storeA,
      passwordRef: { current: "pw" },
    }).ensureKeys();

    // A fresh session over the same backing store must read, not recreate.
    const storeB = memoryStore(files);
    await createCryptoSession({
      store: storeB,
      passwordRef: { current: "pw" },
    }).ensureKeys();

    expect(storeB.reads).toContain(KEY_PARAMS_FILE);
    expect(storeB.writes).toEqual([]);
  });

  it("memoises opaque refs — stable, deterministic, label/id-keyed", async () => {
    const store = memoryStore();
    const session = createCryptoSession({
      store,
      passwordRef: { current: "pw" },
    });
    const keys = await session.ensureKeys();
    expect(keys).not.toBeNull();

    const a1 = await session.cachedRef(keys!, "note", "id-1");
    const a2 = await session.cachedRef(keys!, "note", "id-1");
    const b = await session.cachedRef(keys!, "note", "id-2");
    const c = await session.cachedRef(keys!, "att", "id-1");

    expect(a1).toBe(a2); // memoised
    expect(a1).not.toBe(b); // distinct id
    expect(a1).not.toBe(c); // distinct label, same id
    expect(typeof a1).toBe("string");
    expect(a1.length).toBeGreaterThan(0);
  });

  it("drops every key-derived cache and fires onKeysInvalidated on a passphrase change", async () => {
    const store = memoryStore();
    const passwordRef = { current: "pw1" as string | null };
    const onKeysInvalidated = vi.fn();
    const session = createCryptoSession({
      store,
      passwordRef,
      onKeysInvalidated,
    });

    const keys1 = await session.ensureKeys();
    const ref1 = await session.cachedRef(keys1!, "note", "id-1");
    session.encNoteCache.set("a.enc", { rev: "1", json: "{}" });
    // First transition recorded is null → "pw1"; clear the count for the test.
    onKeysInvalidated.mockClear();

    // Change the passphrase.
    passwordRef.current = "pw2";
    const keys2 = await session.ensureKeys();

    expect(onKeysInvalidated).toHaveBeenCalledTimes(1);
    expect(session.encNoteCache.size).toBe(0); // note cache dropped
    expect(keys2).not.toBe(keys1); // re-derived under the new passphrase
    // The ref cache was dropped too: a re-derivation under the new key yields a
    // different opaque ref for the same label/id.
    const ref2 = await session.cachedRef(keys2!, "note", "id-1");
    expect(ref2).not.toBe(ref1);
  });

  it("fires onKeysInvalidated exactly once per transition, not per call", async () => {
    const store = memoryStore();
    const passwordRef = { current: "pw" as string | null };
    const onKeysInvalidated = vi.fn();
    const session = createCryptoSession({
      store,
      passwordRef,
      onKeysInvalidated,
    });

    await session.ensureKeys(); // null → "pw": one transition
    await session.ensureKeys(); // unchanged: no transition
    await session.ensureKeys(); // unchanged: no transition
    expect(onKeysInvalidated).toHaveBeenCalledTimes(1);

    passwordRef.current = null; // "pw" → null (lock): one more transition
    expect(await session.ensureKeys()).toBeNull();
    expect(onKeysInvalidated).toHaveBeenCalledTimes(2);
  });
});
