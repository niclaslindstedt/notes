// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useNotesSync } from "../../src/app/use-notes-sync.ts";
import type { Snapshot } from "../../src/domain/note.ts";
import type {
  StorageAdapter,
  StoredSnapshot,
} from "../../src/storage/adapter.ts";
import { parse, serialize } from "../../src/storage/serialize.ts";

// A single-note document whose body carries the checkbox state under test.
function snap(body: string): Snapshot {
  return {
    notes: [{ id: "n1", title: "Todo", body, createdAt: 0, updatedAt: 0 }],
  };
}

describe("useNotesSync mount-load race", () => {
  it("keeps an edit made while the mount load is still in flight", async () => {
    // The "toggle a checkbox on open and watch it revert itself" race: a slow
    // (cloud) backend's load() is still in flight when the user edits the note.
    // When the read finally resolves it carries the PRE-edit document —
    // adopting it would revert the edit the user just made. The engine must
    // detect the interleaved edit and keep the local document.
    const seed = serialize(snap("- [ ] buy milk"));
    const edited = snap("- [x] buy milk");

    let releaseLoad!: (v: StoredSnapshot) => void;
    const loadGate = new Promise<StoredSnapshot>((res) => {
      releaseLoad = res;
    });
    let saved: string | null = null;
    const adapter: StorageAdapter = {
      id: "gdrive",
      label: "mem-cloud",
      capabilities: new Set(["loadSync"]),
      loadSync: (): StoredSnapshot => ({ text: seed, revision: "r1" }),
      // The mount read hangs until the test releases it, modelling a slow
      // network round-trip.
      load: () => loadGate,
      save: async (text: string) => {
        saved = text;
        return { text, revision: "r2" };
      },
      saveDebounceMs: 0,
    };

    const { result } = renderHook(() => useNotesSync({ active: adapter }));
    // The synchronous loadSync seed shows the unchecked item immediately.
    expect(result.current.doc.notes[0]!.body).toBe("- [ ] buy milk");

    // The user checks the box while load() is still unresolved. The real edit
    // path paints the change (`setDoc`) and queues the write (`scheduleSave`).
    act(() => {
      result.current.setDoc(edited);
      result.current.scheduleSave(edited);
    });
    expect(result.current.doc.notes[0]!.body).toBe("- [x] buy milk");

    // The slow backend read finally resolves — with the pre-edit document.
    await act(async () => {
      releaseLoad({ text: seed, revision: "r1" });
      await loadGate;
    });

    // The check survives (not reverted by the late load) and was persisted
    // (format-on-save may append a trailing newline to the stored body).
    expect(result.current.doc.notes[0]!.body).toBe("- [x] buy milk");
    expect((parse(saved).notes[0]!.body ?? "").trim()).toBe("- [x] buy milk");
  });

  it("adopts the loaded document when no edit raced the load", async () => {
    // The complementary case: nothing edited while the read was in flight, so
    // the freshly-loaded backend document must replace the loadSync seed.
    const seed = serialize(snap("- [ ] stale local"));
    const remote = serialize(snap("- [x] fresh from backend"));

    let releaseLoad!: (v: StoredSnapshot) => void;
    const loadGate = new Promise<StoredSnapshot>((res) => {
      releaseLoad = res;
    });
    const adapter: StorageAdapter = {
      id: "gdrive",
      label: "mem-cloud",
      capabilities: new Set(["loadSync"]),
      loadSync: (): StoredSnapshot => ({ text: seed, revision: "r1" }),
      load: () => loadGate,
      save: async (text: string) => ({ text, revision: "r2" }),
      saveDebounceMs: 0,
    };

    const { result } = renderHook(() => useNotesSync({ active: adapter }));
    expect(result.current.doc.notes[0]!.body).toBe("- [ ] stale local");

    await act(async () => {
      releaseLoad({ text: remote, revision: "r2" });
      await loadGate;
    });

    expect(result.current.doc.notes[0]!.body).toBe("- [x] fresh from backend");
    expect(result.current.loaded).toBe(true);
  });
});
