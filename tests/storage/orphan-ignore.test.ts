import { describe, expect, it } from "vitest";

import {
  forgetOrphanPath,
  ignoreOrphanPath,
  orphanIgnoreKey,
  readIgnoredOrphans,
} from "../../src/storage/orphan-ignore.ts";

function memoryStorage(): Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
> & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: (k) => raw.get(k) ?? null,
    setItem: (k, v) => void raw.set(k, v),
    removeItem: (k) => void raw.delete(k),
  };
}

describe("orphan ignore list", () => {
  it("round-trips an ignored path", () => {
    const s = memoryStorage();
    ignoreOrphanPath("dropbox", "default", "readme.md", s);
    expect([...readIgnoredOrphans("dropbox", "default", s)]).toEqual([
      "readme.md",
    ]);
  });

  it("scopes the list per backend and namespace", () => {
    const s = memoryStorage();
    ignoreOrphanPath("dropbox", "default", "readme.md", s);

    expect([...readIgnoredOrphans("dropbox", "work", s)]).toEqual([]);
    expect([...readIgnoredOrphans("gdrive", "default", s)]).toEqual([]);
  });

  it("forgets a path so a file that later lands there is flagged again", () => {
    const s = memoryStorage();
    ignoreOrphanPath("folder", "default", "notes.txt", s);
    forgetOrphanPath("folder", "default", "notes.txt", s);

    expect([...readIgnoredOrphans("folder", "default", s)]).toEqual([]);
    // The now-empty list is cleared rather than left as an empty array.
    expect(s.raw.has(orphanIgnoreKey("folder", "default"))).toBe(false);
  });

  it("treats a corrupt list as empty rather than throwing", () => {
    const s = memoryStorage();
    s.setItem(orphanIgnoreKey("folder", "default"), "{not json");

    expect([...readIgnoredOrphans("folder", "default", s)]).toEqual([]);
  });

  it("survives storage being unavailable", () => {
    expect([...readIgnoredOrphans("folder", "default", null)]).toEqual([]);
    expect([
      ...ignoreOrphanPath("folder", "default", "readme.md", null),
    ]).toEqual(["readme.md"]);
  });
});
