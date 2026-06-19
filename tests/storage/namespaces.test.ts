import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_NAMESPACE_SLUG,
  addNamespace,
  getActiveNamespaceSlug,
  getNamespaces,
  hasLocalOnlyNamespaces,
  mergeNamespaceLists,
  namespaceCloudFolder,
  namespaceNotesFolder,
  namespaceLocalKey,
  parseNamespaces,
  removeNamespace,
  renameNamespace,
  serializeNamespaces,
  setActiveNamespaceSlug,
  setNamespaceAppearance,
  slugify,
  type Namespace,
} from "../../src/storage/namespaces.ts";

// The registry reads/writes the global `localStorage`, which the node test
// env lacks — install a minimal in-memory stand-in around each test.
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

describe("slugify", () => {
  it("lowercases, collapses non-alphanumerics, and trims", () => {
    expect(slugify("  My Work Notes!! ")).toBe("my-work-notes");
    expect(slugify("Família 2024")).toBe("fam-lia-2024");
    expect(slugify("...")).toBe("");
  });
});

describe("registry", () => {
  it("always materialises the default namespace first", () => {
    const list = getNamespaces();
    expect(list).toHaveLength(1);
    expect(list[0]?.slug).toBe(DEFAULT_NAMESPACE_SLUG);
  });

  it("adds a namespace with a unique slug and disambiguates collisions", () => {
    const a = addNamespace("Work");
    const b = addNamespace("Work");
    expect(a.slug).toBe("work");
    expect(b.slug).toBe("work-2");
    expect(getNamespaces().map((n) => n.slug)).toEqual([
      "default",
      "work",
      "work-2",
    ]);
  });

  it("rejects an empty name", () => {
    expect(() => addNamespace("   ")).toThrow();
  });

  it("renames the display name without moving the slug", () => {
    const created = addNamespace("Work");
    renameNamespace(created.slug, "Office");
    const ns = getNamespaces().find((n) => n.slug === created.slug);
    expect(ns?.name).toBe("Office");
    expect(ns?.slug).toBe("work");
  });

  it("sets and clears appearance, default namespace included", () => {
    setNamespaceAppearance(DEFAULT_NAMESPACE_SLUG, {
      glyph: "home",
      color: "#fff",
    });
    let def = getNamespaces()[0]!;
    expect(def.glyph).toBe("home");
    expect(def.color).toBe("#fff");
    setNamespaceAppearance(DEFAULT_NAMESPACE_SLUG, { glyph: null });
    def = getNamespaces()[0]!;
    expect(def.glyph).toBeUndefined();
    expect(def.color).toBe("#fff");
  });

  it("removes a namespace and refuses to remove the default", () => {
    const created = addNamespace("Work");
    setActiveNamespaceSlug(created.slug);
    removeNamespace(created.slug);
    expect(getNamespaces().map((n) => n.slug)).toEqual(["default"]);
    // Removing the active namespace falls the cursor back to default.
    expect(getActiveNamespaceSlug()).toBe(DEFAULT_NAMESPACE_SLUG);
    expect(() => removeNamespace(DEFAULT_NAMESPACE_SLUG)).toThrow();
  });

  it("ignores an unknown active slug, falling back to default", () => {
    setActiveNamespaceSlug("nope");
    expect(getActiveNamespaceSlug()).toBe(DEFAULT_NAMESPACE_SLUG);
  });
});

describe("storage location helpers", () => {
  it("keeps the default at the historical key / root, others namespaced", () => {
    expect(namespaceLocalKey(DEFAULT_NAMESPACE_SLUG)).toBe("notes/v1");
    expect(namespaceLocalKey("work")).toBe("notes/v1:work");
    expect(namespaceCloudFolder(DEFAULT_NAMESPACE_SLUG)).toBe("");
    expect(namespaceCloudFolder("work")).toBe("work");
  });

  it("nests note files in a notes/ subfolder of the namespace", () => {
    expect(namespaceNotesFolder(DEFAULT_NAMESPACE_SLUG)).toBe("notes");
    expect(namespaceNotesFolder("work")).toBe("work/notes");
  });
});

describe("registry serialization and merge", () => {
  it("round-trips through serialize / parse, normalising the result", () => {
    const list: Namespace[] = [
      { slug: "work", name: "Work" },
      { slug: DEFAULT_NAMESPACE_SLUG, name: "Default" },
    ];
    const parsed = parseNamespaces(serializeNamespaces(list));
    expect(parsed.map((n) => n.slug)).toEqual(["default", "work"]);
  });

  it("falls back to just the default for missing or corrupt JSON", () => {
    expect(parseNamespaces(null).map((n) => n.slug)).toEqual(["default"]);
    expect(parseNamespaces("{not json").map((n) => n.slug)).toEqual([
      "default",
    ]);
  });

  it("merges with the backend winning on shared slugs", () => {
    const local: Namespace[] = [
      { slug: "default", name: "Default" },
      { slug: "work", name: "Local Work" },
      { slug: "solo", name: "Solo" },
    ];
    const remote: Namespace[] = [
      { slug: "default", name: "Default" },
      { slug: "work", name: "Remote Work", glyph: "briefcase" },
    ];
    const merged = mergeNamespaceLists(local, remote);
    expect(merged.find((n) => n.slug === "work")?.name).toBe("Remote Work");
    expect(merged.find((n) => n.slug === "solo")?.name).toBe("Solo");
    expect(hasLocalOnlyNamespaces(local, remote)).toBe(true);
    expect(hasLocalOnlyNamespaces(remote, remote)).toBe(false);
  });
});
