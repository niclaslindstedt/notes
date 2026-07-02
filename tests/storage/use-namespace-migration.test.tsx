// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Folder, Note } from "../../src/domain/note.ts";
import type {
  StorageAdapter,
  StoredSnapshot,
} from "../../src/storage/adapter.ts";
import { parse, serialize } from "../../src/storage/serialize.ts";
import {
  type NamespaceMigrationDeps,
  useNamespaceMigration,
} from "../../src/storage/useNamespaceMigration.ts";

// A fake in-memory adapter that holds one document's bytes and records every
// save, standing in for a namespace's storage location. Optional attachment /
// body fetch hooks let the tests exercise the hydration branches.
function fakeAdapter(
  id: StorageAdapter["id"] = "browser",
  initial: string | null = null,
): StorageAdapter & { saves: string[] } {
  let current: StoredSnapshot | null =
    initial === null ? null : { text: initial };
  const saves: string[] = [];
  return {
    id,
    label: id,
    capabilities: new Set(),
    saves,
    async load() {
      return current;
    },
    async save(text: string) {
      saves.push(text);
      current = { text };
      return current;
    },
  };
}

function note(over: Partial<Note> = {}): Note {
  return {
    id: "n1",
    title: "Note",
    body: "hello",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function folder(over: Partial<Folder> = {}): Folder {
  return { id: "f1", name: "Folder", createdAt: 1, ...over };
}

// Build the hook deps around a set of per-namespace target adapters. `makeInner`
// hands back the adapter registered for the requested slug (creating an empty
// one on demand), so tests can inspect what each namespace received.
function makeDeps(
  over: Partial<NamespaceMigrationDeps> = {},
): NamespaceMigrationDeps & {
  targets: Map<string, ReturnType<typeof fakeAdapter>>;
} {
  const targets = new Map<string, ReturnType<typeof fakeAdapter>>();
  const makeInner = (namespace: string) => {
    let a = targets.get(namespace);
    if (!a) {
      a = fakeAdapter("browser");
      targets.set(namespace, a);
    }
    return a;
  };
  return {
    targets,
    locked: false,
    activeNamespace: "default",
    namespaces: [
      { slug: "default", name: "Default" },
      { slug: "work", name: "Work" },
    ],
    inner: fakeAdapter("browser"),
    isBrowserBackend: true,
    wrapBrowserForActive: (raw) => raw,
    makeInner,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useNamespaceMigration", () => {
  describe("no-op guards", () => {
    it("returns false while locked", async () => {
      const deps = makeDeps({ locked: true });
      const { result } = renderHook(() => useNamespaceMigration(deps));
      expect(await result.current.moveNoteToNamespace(note(), "work")).toBe(
        false,
      );
      expect(
        await result.current.moveFolderToNamespace(folder(), [note()], "work"),
      ).toBe(false);
      expect(deps.targets.size).toBe(0);
    });

    it("returns false when the target is the active namespace", async () => {
      const deps = makeDeps();
      const { result } = renderHook(() => useNamespaceMigration(deps));
      expect(await result.current.moveNoteToNamespace(note(), "default")).toBe(
        false,
      );
      expect(deps.targets.size).toBe(0);
    });

    it("returns false for an unknown target slug", async () => {
      const deps = makeDeps();
      const { result } = renderHook(() => useNamespaceMigration(deps));
      expect(await result.current.moveNoteToNamespace(note(), "ghost")).toBe(
        false,
      );
      expect(deps.targets.size).toBe(0);
    });
  });

  describe("moveNoteToNamespace", () => {
    it("writes the note into the target document and returns true", async () => {
      const deps = makeDeps();
      const { result } = renderHook(() => useNamespaceMigration(deps));
      const ok = await result.current.moveNoteToNamespace(
        note({ id: "n1", title: "Hi" }),
        "work",
      );
      expect(ok).toBe(true);
      const target = deps.targets.get("work")!;
      expect(target.saves.length).toBe(1);
      const doc = parse(target.saves[0]);
      expect(doc.notes.map((n) => n.id)).toEqual(["n1"]);
      expect(doc.notes[0]?.title).toBe("Hi");
    });

    it("drops the source folderId (the target has its own folders)", async () => {
      const deps = makeDeps();
      const { result } = renderHook(() => useNamespaceMigration(deps));
      await result.current.moveNoteToNamespace(
        note({ folderId: "f-source" }),
        "work",
      );
      const doc = parse(deps.targets.get("work")!.saves[0]);
      expect(doc.notes[0]?.folderId).toBeUndefined();
    });

    it("prepends the note ahead of a same-id remnant already in the target", async () => {
      const seeded = serialize({
        notes: [note({ id: "n1", title: "Stale" })],
        folders: [],
      });
      const targets = new Map<string, ReturnType<typeof fakeAdapter>>();
      targets.set("work", fakeAdapter("browser", seeded));
      const deps = makeDeps({
        makeInner: (ns) => targets.get(ns) ?? fakeAdapter("browser"),
      });
      // Point the shared map at our pre-seeded target.
      deps.targets.set("work", targets.get("work")!);
      const { result } = renderHook(() => useNamespaceMigration(deps));
      await result.current.moveNoteToNamespace(
        note({ id: "n1", title: "Fresh" }),
        "work",
      );
      const doc = parse(targets.get("work")!.saves[0]);
      expect(doc.notes.map((n) => n.id)).toEqual(["n1"]);
      expect(doc.notes[0]?.title).toBe("Fresh");
    });

    it("hydrates attachment bytes from the source adapter before moving", async () => {
      const fetchAttachment = vi.fn(async () => ({
        mime: "text/plain",
        bytes: new Uint8Array([104, 105]),
      }));
      const inner = { ...fakeAdapter("folder"), fetchAttachment };
      const deps = makeDeps({ inner, isBrowserBackend: false });
      const { result } = renderHook(() => useNamespaceMigration(deps));
      await result.current.moveNoteToNamespace(
        note({ attachments: [{ filename: "a.txt", mime: "text/plain" }] }),
        "work",
      );
      expect(fetchAttachment).toHaveBeenCalledOnce();
      const doc = parse(deps.targets.get("work")!.saves[0]);
      expect(doc.notes[0]?.attachments?.[0]?.data).toMatch(/^data:text\/plain/);
    });

    it("returns false when the target save throws", async () => {
      const failing = fakeAdapter("browser");
      failing.save = async () => {
        throw new Error("quota");
      };
      const deps = makeDeps({ makeInner: () => failing });
      const { result } = renderHook(() => useNamespaceMigration(deps));
      expect(await result.current.moveNoteToNamespace(note(), "work")).toBe(
        false,
      );
    });

    it("wraps the target with the browser encryption layer on the browser backend", async () => {
      const wrapBrowserForActive = vi.fn((raw: StorageAdapter) => raw);
      const deps = makeDeps({ isBrowserBackend: true, wrapBrowserForActive });
      const { result } = renderHook(() => useNamespaceMigration(deps));
      await result.current.moveNoteToNamespace(note(), "work");
      expect(wrapBrowserForActive).toHaveBeenCalledOnce();
    });

    it("does not wrap on a non-browser backend", async () => {
      const wrapBrowserForActive = vi.fn((raw: StorageAdapter) => raw);
      const deps = makeDeps({ isBrowserBackend: false, wrapBrowserForActive });
      const { result } = renderHook(() => useNamespaceMigration(deps));
      await result.current.moveNoteToNamespace(note(), "work");
      expect(wrapBrowserForActive).not.toHaveBeenCalled();
    });
  });

  describe("moveFolderToNamespace", () => {
    it("carries the folder record and its notes into the target", async () => {
      const deps = makeDeps();
      const { result } = renderHook(() => useNamespaceMigration(deps));
      const ok = await result.current.moveFolderToNamespace(
        folder({ id: "f1", name: "Trips" }),
        [
          note({ id: "n1", folderId: "f1" }),
          note({ id: "n2", folderId: "f1" }),
        ],
        "work",
      );
      expect(ok).toBe(true);
      const doc = parse(deps.targets.get("work")!.saves[0]);
      expect(doc.folders?.map((f) => f.id)).toEqual(["f1"]);
      expect(doc.notes.map((n) => n.id)).toEqual(["n1", "n2"]);
      // The notes stay filed under the folder in the target.
      expect(doc.notes.every((n) => n.folderId === "f1")).toBe(true);
    });

    it("hydrates deferred note bodies from the source adapter", async () => {
      const fetchNoteBody = vi.fn(async () => "recovered body");
      const inner = { ...fakeAdapter("folder"), fetchNoteBody };
      const deps = makeDeps({ inner, isBrowserBackend: false });
      const { result } = renderHook(() => useNamespaceMigration(deps));
      await result.current.moveFolderToNamespace(
        folder(),
        [note({ id: "n1", body: undefined, preview: "x", folderId: "f1" })],
        "work",
      );
      expect(fetchNoteBody).toHaveBeenCalledOnce();
      const doc = parse(deps.targets.get("work")!.saves[0]);
      expect(doc.notes[0]?.body).toBe("recovered body");
    });

    it("replaces a same-id folder remnant already in the target", async () => {
      const seeded = serialize({
        notes: [],
        folders: [folder({ id: "f1", name: "Stale" })],
      });
      const seededTarget = fakeAdapter("browser", seeded);
      const deps = makeDeps({ makeInner: () => seededTarget });
      deps.targets.set("work", seededTarget);
      const { result } = renderHook(() => useNamespaceMigration(deps));
      await result.current.moveFolderToNamespace(
        folder({ id: "f1", name: "Fresh" }),
        [],
        "work",
      );
      const doc = parse(seededTarget.saves[0]);
      expect(doc.folders?.filter((f) => f.id === "f1").length).toBe(1);
      expect(doc.folders?.[0]?.name).toBe("Fresh");
    });

    it("returns false when the target save throws", async () => {
      const failing = fakeAdapter("browser");
      failing.save = async () => {
        throw new Error("quota");
      };
      const deps = makeDeps({ makeInner: () => failing });
      const { result } = renderHook(() => useNamespaceMigration(deps));
      expect(
        await result.current.moveFolderToNamespace(folder(), [note()], "work"),
      ).toBe(false);
    });
  });
});
