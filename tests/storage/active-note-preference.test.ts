import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getActiveNote,
  setActiveNote,
} from "../../src/storage/active-note-preference.ts";

// The cursor reads/writes the global `localStorage`, which the node test env
// lacks — install a minimal in-memory stand-in around each test.
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

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
});

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("active note cursor", () => {
  it("returns null when nothing was stored", () => {
    expect(getActiveNote("default")).toBeNull();
  });

  it("round-trips a stored note id", () => {
    setActiveNote("default", "note-1");
    expect(getActiveNote("default")).toBe("note-1");
  });

  it("keeps each namespace's cursor independent", () => {
    setActiveNote("default", "note-1");
    setActiveNote("work", "note-2");
    expect(getActiveNote("default")).toBe("note-1");
    expect(getActiveNote("work")).toBe("note-2");
  });

  it("clears the cursor when set to null", () => {
    setActiveNote("default", "note-1");
    setActiveNote("default", null);
    expect(getActiveNote("default")).toBeNull();
  });

  it("survives a write/read cycle through the same backing store", () => {
    setActiveNote("work", "note-9");
    // A fresh read (simulating a reload) sees the persisted value.
    expect(getActiveNote("work")).toBe("note-9");
  });
});
