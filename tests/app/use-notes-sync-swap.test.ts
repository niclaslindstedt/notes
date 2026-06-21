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

// A single-note document, identified by id so a test can tell which adapter's
// cache is on screen.
function snap(id: string, title: string): Snapshot {
  return { notes: [{ id, title, body: "", createdAt: 0, updatedAt: 0 }] };
}

// A backend whose synchronous `loadSync` returns its cached document at once,
// and whose async `load` never resolves — so a test observes the *synchronous*
// reseed across a swap before any live load could land. This is the localStorage
// fast path (browser) and the offline mirror (cloud) in miniature.
function makeAdapter(doc: Snapshot): StorageAdapter {
  const text = serialize(doc);
  return {
    id: "browser",
    label: "Test",
    capabilities: new Set(["loadSync"]),
    loadSync: (): StoredSnapshot => ({ text }),
    load: () => new Promise<StoredSnapshot | null>(() => {}),
    save: async (t) => ({ text: t }),
  };
}

describe("useNotesSync adapter swap", () => {
  it("reseeds from the new adapter's cached index immediately on swap", () => {
    const a = makeAdapter(snap("a", "Alpha"));
    const b = makeAdapter(snap("b", "Beta"));

    const { result, rerender } = renderHook(
      ({ adapter }) => useNotesSync({ active: adapter }),
      { initialProps: { adapter: a } },
    );
    expect(result.current.doc.notes.map((n) => n.id)).toEqual(["a"]);

    // Swapping the adapter (a namespace switch) must paint the target's cached
    // content right away — never leave the previous namespace's notes on screen
    // while the async load runs.
    act(() => rerender({ adapter: b }));
    expect(result.current.doc.notes.map((n) => n.id)).toEqual(["b"]);
    expect(result.current.loaded).toBe(false);
  });

  it("clears to a blank document when the new adapter has nothing cached", () => {
    const a = makeAdapter(snap("a", "Alpha"));
    // A never-visited namespace: no synchronous cache, and a load that hasn't
    // resolved yet. The swap must clear the stale notes rather than keep them.
    const empty: StorageAdapter = {
      id: "dropbox",
      label: "Empty",
      capabilities: new Set(),
      load: () => new Promise<StoredSnapshot | null>(() => {}),
      save: async (t) => ({ text: t }),
    };

    const { result, rerender } = renderHook(
      ({ adapter }) => useNotesSync({ active: adapter }),
      { initialProps: { adapter: a } },
    );
    expect(result.current.doc.notes).toHaveLength(1);

    act(() => rerender({ adapter: empty }));
    expect(result.current.doc.notes).toHaveLength(0);
  });
});
