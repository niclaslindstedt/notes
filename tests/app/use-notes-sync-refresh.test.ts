// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useNotesSync } from "../../src/app/use-notes-sync.ts";
import type { Snapshot } from "../../src/domain/note.ts";
import type {
  StorageAdapter,
  StoredSnapshot,
} from "../../src/storage/adapter.ts";
import { serialize } from "../../src/storage/serialize.ts";

// The pull-vs-edit races: an automatic pull (foreground refresh, open-note
// refresh, pull-to-refresh) must never replace text that hasn't reached the
// backend yet. Regression tests for typed text disappearing on the cloud
// backends when a pull raced the debounced save (the "text disappears when
// the document has been saved" bug).

function snap(title: string): Snapshot {
  return { notes: [{ id: "n1", title, body: "", createdAt: 0, updatedAt: 0 }] };
}

function stored(title: string, revision: string): StoredSnapshot {
  return { text: serialize(snap(title)), revision };
}

// A fake cloud-shaped adapter: a non-zero debounce (so saves are scheduled,
// not immediate), a `save` that records every write, and a `load` whose
// result — and count — each test controls.
function makeAdapter(opts: {
  debounceMs?: number;
  load?: () => Promise<StoredSnapshot | null>;
  save?: StorageAdapter["save"];
}): { adapter: StorageAdapter; saves: string[]; loads: () => number } {
  const saves: string[] = [];
  let loads = 0;
  let rev = 0;
  const adapter: StorageAdapter = {
    id: "dropbox",
    label: "Test",
    capabilities: new Set(),
    saveDebounceMs: opts.debounceMs ?? 30,
    load: () => {
      loads += 1;
      return opts.load ? opts.load() : Promise.resolve(null);
    },
    save:
      opts.save ??
      (async (text) => {
        saves.push(text);
        rev += 1;
        return { text, revision: `s${rev}` };
      }),
  };
  return { adapter, saves, loads: () => loads };
}

// Let the debounce timer fire and any save/load promise resolve.
async function settle(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe("useNotesSync automatic pulls vs unsaved edits", () => {
  it("refresh skips the pull while an edit sits behind the debounce", async () => {
    const { adapter, saves, loads } = makeAdapter({
      debounceMs: 60,
      load: () => Promise.resolve(stored("Remote", "r-remote")),
    });
    const { result } = renderHook(() => useNotesSync({ active: adapter }));
    await settle(10);
    expect(loads()).toBe(1);

    // Type: the edit is on screen and queued, but not yet on the backend.
    act(() => {
      result.current.setDoc(snap("Typed"));
      result.current.scheduleSave(snap("Typed"));
    });
    await act(() => result.current.refresh());

    // No pull ran, and the typed text is still on screen.
    expect(loads()).toBe(1);
    expect(result.current.doc.notes[0]?.title).toBe("Typed");

    // Once the save drains, the same refresh pulls normally again.
    await settle(120);
    expect(saves).toHaveLength(1);
    await act(() => result.current.refresh());
    expect(loads()).toBe(2);
  });

  it("refresh skips the pull while a save is in flight", async () => {
    let resolveSave: (() => void) | null = null;
    const { adapter, loads } = makeAdapter({
      debounceMs: 0,
      save: (text) =>
        new Promise((resolve) => {
          resolveSave = () => resolve({ text, revision: "s1" });
        }),
    });
    const { result } = renderHook(() => useNotesSync({ active: adapter }));
    await settle(10);
    expect(loads()).toBe(1);

    // Zero debounce: the save launches immediately and is now in flight.
    act(() => {
      result.current.setDoc(snap("Uploading"));
      result.current.scheduleSave(snap("Uploading"));
    });
    await act(() => result.current.refresh());
    expect(loads()).toBe(1);
    expect(result.current.doc.notes[0]?.title).toBe("Uploading");

    await act(async () => {
      resolveSave?.();
      await Promise.resolve();
    });
  });

  it("reload keeps the local copy when a keystroke lands mid-pull", async () => {
    const pendingLoads: Array<(s: StoredSnapshot | null) => void> = [];
    let first = true;
    const { adapter } = makeAdapter({
      debounceMs: 60_000,
      load: () => {
        if (first) {
          first = false;
          return Promise.resolve(stored("Seed", "r1"));
        }
        return new Promise((resolve) => pendingLoads.push(resolve));
      },
    });
    const { result } = renderHook(() => useNotesSync({ active: adapter }));
    await settle(10);
    expect(result.current.doc.notes[0]?.title).toBe("Seed");

    // Start a pull; the backend round-trip hangs (a slow cloud listing).
    let reloadDone: Promise<void>;
    act(() => {
      reloadDone = result.current.reload();
    });

    // A keystroke lands while the pull is still in flight.
    act(() => {
      result.current.setDoc(snap("Typed mid-pull"));
      result.current.scheduleSave(snap("Typed mid-pull"));
    });

    // The pull resolves with the pre-keystroke remote copy — adopting it
    // would wipe the keystroke off the screen.
    await act(async () => {
      pendingLoads[0]?.(stored("Remote without the keystroke", "r2"));
      await reloadDone;
    });

    expect(result.current.doc.notes[0]?.title).toBe("Typed mid-pull");
    expect(result.current.dirty).toBe(true);
  });

  it("backgrounding the app flushes the pending debounced save", async () => {
    const { adapter, saves } = makeAdapter({ debounceMs: 60_000 });
    const { result } = renderHook(() => useNotesSync({ active: adapter }));
    await settle(10);

    // Type: with a long debounce the save would sit armed for a while —
    // longer than a backgrounded mobile tab is guaranteed to live.
    act(() => {
      result.current.setDoc(snap("Backgrounded"));
      result.current.scheduleSave(snap("Backgrounded"));
    });
    expect(saves).toHaveLength(0);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    try {
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await settle(10);
      expect(saves).toHaveLength(1);
      expect(saves[0]).toContain("Backgrounded");
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState;
    }
  });
});
