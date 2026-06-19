// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useNotesSync } from "../../src/app/use-notes-sync.ts";
import type { Snapshot } from "../../src/domain/note.ts";
import type { StorageAdapter } from "../../src/storage/adapter.ts";

// A single-note snapshot whose title is the value under test — the title is
// what the file/cloud backends slug into a filename, so it's the bit the
// save-hold exists to get right before the first write.
function snap(title: string): Snapshot {
  return { notes: [{ id: "n1", title, body: "", createdAt: 0, updatedAt: 0 }] };
}

// A fake cloud-shaped adapter: a non-zero debounce (so saves are scheduled,
// not immediate) and a `save` that records every write's serialized text.
function makeAdapter(debounceMs = 30): {
  adapter: StorageAdapter;
  saves: string[];
} {
  const saves: string[] = [];
  let rev = 0;
  const adapter: StorageAdapter = {
    id: "dropbox",
    label: "Test",
    capabilities: new Set(),
    saveDebounceMs: debounceMs,
    load: async () => null,
    save: async (text) => {
      saves.push(text);
      rev += 1;
      return { text, revision: String(rev) };
    },
  };
  return { adapter, saves };
}

// Let the debounce timer fire and any save promise resolve.
async function settle(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe("useNotesSync save hold", () => {
  it("saves a scheduled edit normally when nothing is held", async () => {
    const { adapter, saves } = makeAdapter();
    const { result } = renderHook(() => useNotesSync({ active: adapter }));
    await settle(10);

    act(() => result.current.scheduleSave(snap("Hello")));
    await settle(80);

    expect(saves).toHaveLength(1);
    expect(saves[0]).toContain("Hello");
  });

  it("writes nothing while held, then once with the settled title", async () => {
    const { adapter, saves } = makeAdapter();
    const { result } = renderHook(() => useNotesSync({ active: adapter }));
    await settle(10);

    // A fresh note is created under a hold with its throwaway default title.
    act(() => {
      result.current.holdSaves();
      result.current.scheduleSave(snap("Default"));
    });
    await settle(80);
    expect(saves).toHaveLength(0); // held — no file written past the debounce
    expect(result.current.dirty).toBe(true); // but flagged unsaved

    // The user types a real title; still held, so still nothing on the backend.
    act(() => result.current.scheduleSave(snap("Real Title")));
    await settle(80);
    expect(saves).toHaveLength(0);

    // Title settles → release drains exactly one write, bearing the real title
    // (never the default), so the file is created already correctly named.
    act(() => result.current.releaseSaves());
    await settle(80);
    expect(saves).toHaveLength(1);
    expect(saves[0]).toContain("Real Title");
    expect(saves[0]).not.toContain("Default");
  });

  it("cancels a save already scheduled when the hold goes on", async () => {
    const { adapter, saves } = makeAdapter();
    const { result } = renderHook(() => useNotesSync({ active: adapter }));
    await settle(10);

    // Hold racing in right after a scheduled save must swallow that armed timer
    // so the pre-hold write can't slip through the window.
    act(() => {
      result.current.scheduleSave(snap("Armed"));
      result.current.holdSaves();
    });
    await settle(80);
    expect(saves).toHaveLength(0);

    act(() => result.current.releaseSaves());
    await settle(80);
    expect(saves).toHaveLength(1);
  });

  it("releaseSaves is a no-op when no hold is active", async () => {
    const { adapter, saves } = makeAdapter();
    const { result } = renderHook(() => useNotesSync({ active: adapter }));
    await settle(10);

    act(() => result.current.releaseSaves());
    await settle(80);
    expect(saves).toHaveLength(0);
  });
});
