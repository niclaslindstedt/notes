// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/preact";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { unlock } from "../../src/achievements/index.ts";
import {
  getActiveNamespaceSlug,
  namespaceLocalKey,
} from "../../src/storage/namespaces.ts";
import type { NamespaceRegistryStore } from "../../src/storage/namespace-store.ts";
import {
  type NamespaceRegistryDeps,
  useNamespaceRegistry,
} from "../../src/storage/useNamespaceRegistry.ts";

// The hook fires the "compartments" achievement on create via the bus; spy on
// it rather than draining the real bus.
vi.mock("../../src/achievements/index.ts", () => ({
  unlock: vi.fn(),
}));

// The cloud data-delete helpers reach the network; the hook only needs them to
// route a removal on a cloud backend, so stub them and assert the call.
const deleteDropboxNamespace = vi.fn(
  async (_token: string, _slug: string) => {},
);
const deleteGdriveNamespace = vi.fn(
  async (_token: string, _slug: string) => {},
);
vi.mock("../../src/storage/dropbox/index.ts", () => ({
  deleteDropboxNamespace: (token: string, slug: string) =>
    deleteDropboxNamespace(token, slug),
}));
vi.mock("../../src/storage/gdrive/index.ts", () => ({
  deleteGdriveNamespace: (token: string, slug: string) =>
    deleteGdriveNamespace(token, slug),
}));

// An in-memory `namespaces.json` store that records every save.
function fakeStore(
  initial: string | null = null,
): NamespaceRegistryStore & { saves: string[] } {
  let current = initial;
  const saves: string[] = [];
  return {
    saves,
    async load() {
      return current;
    },
    async save(text: string) {
      current = text;
      saves.push(text);
    },
  };
}

const browserDeps = (
  over: Partial<NamespaceRegistryDeps> = {},
): Omit<NamespaceRegistryDeps, "activeNamespace" | "setActiveNamespace"> & {
  activeNamespace?: string;
} => ({
  namespaceStore: null,
  backend: "browser",
  dropboxToken: null,
  gdriveToken: null,
  folderHandle: null,
  notesdConfig: null,
  ...over,
});

// The active-namespace cursor is owned by the caller (`useStorageBackend`)
// rather than the registry, because the per-namespace encryption state machine
// runs first and needs it. So the tests hold it themselves and hand it back on
// `result.current` for the assertions that read it.
function renderRegistry(over: Partial<NamespaceRegistryDeps> = {}) {
  return renderHook(() => {
    const [activeNamespace, setActiveNamespace] = useState(
      getActiveNamespaceSlug,
    );
    const registry = useNamespaceRegistry({
      ...browserDeps(over),
      activeNamespace,
      setActiveNamespace,
    } as NamespaceRegistryDeps);
    return { ...registry, activeNamespace };
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("useNamespaceRegistry", () => {
  it("seeds from localStorage with just the default namespace active", () => {
    const { result } = renderRegistry();
    expect(result.current.namespaces.map((n) => n.slug)).toEqual(["default"]);
    expect(result.current.activeNamespace).toBe("default");
  });

  it("createNamespace adds, switches to it, mirrors to the store, and unlocks", () => {
    const store = fakeStore();
    const { result } = renderRegistry({ namespaceStore: store });
    act(() => result.current.createNamespace("Work"));
    expect(result.current.namespaces.map((n) => n.slug)).toEqual([
      "default",
      "work",
    ]);
    // Lands the user in the new namespace.
    expect(result.current.activeNamespace).toBe("work");
    // Mirrored into `namespaces.json`.
    expect(store.saves.length).toBeGreaterThan(0);
    expect(store.saves.at(-1)).toContain("work");
    expect(unlock).toHaveBeenCalledWith("compartments");
  });

  it("createNamespace applies a chosen appearance", () => {
    const { result } = renderRegistry();
    act(() =>
      result.current.createNamespace("Travel", {
        glyph: "plane",
        color: "#09f",
      }),
    );
    const travel = result.current.namespaces.find((n) => n.slug === "travel");
    expect(travel).toMatchObject({ glyph: "plane", color: "#09f" });
  });

  it("renameNamespace changes the display name but keeps the slug", () => {
    const { result } = renderRegistry();
    act(() => result.current.createNamespace("Work"));
    act(() => result.current.renameNamespace("work", "Office"));
    const ns = result.current.namespaces.find((n) => n.slug === "work");
    expect(ns?.name).toBe("Office");
  });

  it("setNamespaceAppearance applies and clears live", () => {
    const { result } = renderRegistry();
    act(() => result.current.createNamespace("Work"));
    act(() => result.current.setNamespaceAppearance("work", { color: "#f00" }));
    expect(
      result.current.namespaces.find((n) => n.slug === "work")?.color,
    ).toBe("#f00");
    act(() => result.current.setNamespaceAppearance("work", { color: null }));
    expect(
      result.current.namespaces.find((n) => n.slug === "work")?.color,
    ).toBeUndefined();
  });

  it("switchNamespace flips the active cursor and persists it", () => {
    const { result } = renderRegistry();
    act(() => result.current.createNamespace("Work"));
    act(() => result.current.switchNamespace("default"));
    expect(result.current.activeNamespace).toBe("default");
    // Re-reading the registry sees the persisted active pointer.
    const { result: reread } = renderRegistry();
    expect(reread.current.activeNamespace).toBe("default");
  });

  it("removeNamespace rejects the default namespace", async () => {
    const { result } = renderRegistry();
    await expect(result.current.removeNamespace("default")).rejects.toThrow(
      /default namespace can't be removed/,
    );
  });

  it("removeNamespace drops the entry, resets active, and deletes the local document", async () => {
    const { result } = renderRegistry();
    act(() => result.current.createNamespace("Work"));
    // Seed a document under the namespace's localStorage key so the delete is observable.
    localStorage.setItem(namespaceLocalKey("work"), '{"notes":[]}');
    expect(result.current.activeNamespace).toBe("work");
    await act(async () => {
      await result.current.removeNamespace("work");
    });
    expect(result.current.namespaces.map((n) => n.slug)).toEqual(["default"]);
    // Active fell back to default because the removed one was active.
    expect(result.current.activeNamespace).toBe("default");
    // The namespace's document bytes are gone.
    expect(localStorage.getItem(namespaceLocalKey("work"))).toBeNull();
  });

  it("removeNamespace routes the data-delete to the active cloud backend", async () => {
    const { result } = renderRegistry({
      backend: "dropbox",
      dropboxToken: "tok",
    });
    act(() => result.current.createNamespace("Work"));
    await act(async () => {
      await result.current.removeNamespace("work");
    });
    expect(deleteDropboxNamespace).toHaveBeenCalledWith("tok", "work");
    expect(deleteGdriveNamespace).not.toHaveBeenCalled();
  });

  it("reconcile effect seeds an empty backend with the local registry", async () => {
    const store = fakeStore(null);
    renderRegistry({ namespaceStore: store });
    await waitFor(() => expect(store.saves.length).toBe(1));
    expect(store.saves[0]).toContain("default");
  });

  it("reconcile effect adopts the backend's list and pushes local-only ones back", async () => {
    // This device has a local-only "personal" namespace; the backend knows "shared".
    localStorage.setItem(
      "notes:namespaces",
      JSON.stringify([
        { slug: "default", name: "Default" },
        { slug: "personal", name: "Personal" },
      ]),
    );
    const store = fakeStore(
      JSON.stringify([
        { slug: "default", name: "Default" },
        { slug: "shared", name: "Shared" },
      ]),
    );
    const { result } = renderRegistry({ namespaceStore: store });
    await waitFor(() =>
      expect(result.current.namespaces.map((n) => n.slug).sort()).toEqual([
        "default",
        "personal",
        "shared",
      ]),
    );
    // The merged list (carrying the local-only "personal") is pushed back up.
    await waitFor(() => expect(store.saves.length).toBe(1));
    expect(store.saves[0]).toContain("personal");
  });
});
