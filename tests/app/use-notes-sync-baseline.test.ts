// @vitest-environment jsdom
//
// The save baseline: which backend revision a write claims to be a forward step
// from. Getting this wrong is how "I typed a lot on the desktop, then opened my
// phone, and the desktop's text was gone" happens — the phone writes from no
// baseline at all, and the backend has nothing to refuse it with.

import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/preact";

import { useNotesSync } from "../../src/app/use-notes-sync.ts";
import type { Snapshot } from "../../src/domain/note.ts";
import type {
  StorageAdapter,
  StoredSnapshot,
} from "../../src/storage/adapter.ts";
import { serialize } from "../../src/storage/serialize.ts";

function snap(body: string): Snapshot {
  return {
    notes: [{ id: "n1", title: "Todo", body, createdAt: 0, updatedAt: 0 }],
  };
}

// A cloud-shaped adapter whose load hangs until the test releases it.
// `saveDebounceMs` defaults to 0 for immediacy; pass a real debounce to model
// the cloud backends, where a keystroke's write is still waiting out its window
// when the mount load resolves.
function gatedAdapter(opts: {
  seed?: StoredSnapshot | null;
  saves: { text: string; base?: string }[];
  saveDebounceMs?: number;
}): { adapter: StorageAdapter; release: (v: StoredSnapshot | null) => void } {
  let release!: (v: StoredSnapshot | null) => void;
  const gate = new Promise<StoredSnapshot | null>((res) => {
    release = res;
  });
  return {
    release,
    adapter: {
      id: "dropbox",
      label: "mem-cloud",
      capabilities: new Set(["loadSync"]),
      loadSync: () => opts.seed ?? null,
      load: () => gate,
      save: async (text: string, base?: string) => {
        opts.saves.push({ text, base });
        return { text, revision: "r-saved" };
      },
      saveDebounceMs: opts.saveDebounceMs ?? 0,
    },
  };
}

describe("useNotesSync save baseline", () => {
  it("writes an edit made during the mount load against the mirror's revision", async () => {
    // The phone opens with a warm offline mirror and the user types before the
    // cloud round-trip finishes. That write must carry the mirror's revision so
    // the backend can tell whether anything moved underneath it.
    const saves: { text: string; base?: string }[] = [];
    const { adapter, release } = gatedAdapter({
      seed: { text: serialize(snap("from the mirror")), revision: "r1" },
      saves,
    });

    const { result } = renderHook(() => useNotesSync({ active: adapter }));
    const edited = snap("typed on the phone");
    act(() => {
      result.current.setDoc(edited);
      result.current.scheduleSave(edited);
    });

    expect(saves).toHaveLength(1);
    expect(saves[0]!.base).toBe("r1");

    await act(async () => {
      release({ text: serialize(snap("from the mirror")), revision: "r1" });
    });
    expect(result.current.doc.notes[0]!.body).toBe("typed on the phone");
  });

  it("does not adopt the loaded revision for a document built from local edits", async () => {
    // The load resolves with a revision the on-screen document is NOT based on
    // (we kept the local edit and set the remote copy aside). Claiming it as
    // the baseline would tell the backend the next write is a forward step
    // from its current state — and the other device's work would go silently.
    const saves: { text: string; base?: string }[] = [];
    const { adapter, release } = gatedAdapter({
      seed: { text: serialize(snap("from the mirror")), revision: "r1" },
      saves,
      // A cloud write waits out its debounce, so it is still queued when the
      // mount load lands — the ordering this whole branch is about.
      saveDebounceMs: 1000,
    });

    const { result } = renderHook(() => useNotesSync({ active: adapter }));
    const edited = snap("typed on the phone");
    act(() => {
      result.current.setDoc(edited);
      result.current.scheduleSave(edited);
    });
    expect(saves).toHaveLength(0);

    // The backend has moved on — another device wrote r9 while we were reading.
    await act(async () => {
      release({
        text: serialize(snap("the long desktop note")),
        revision: "r9",
      });
    });

    // Still based on r1, the last revision this device actually reconciled
    // with — never r9, which it read and set aside.
    expect(saves).toHaveLength(1);
    expect(saves[0]!.base).toBe("r1");
  });

  it("raises a conflict when local edits race the first load on a device with no baseline", async () => {
    // Nothing cached, so the edit is based on nothing the backend has ever
    // confirmed. There is no honest merge to attempt — ask.
    const saves: { text: string; base?: string }[] = [];
    const { adapter, release } = gatedAdapter({
      seed: null,
      saves,
      saveDebounceMs: 1000,
    });

    const { result } = renderHook(() => useNotesSync({ active: adapter }));
    const edited = snap("typed before the first load landed");
    act(() => {
      result.current.setDoc(edited);
      result.current.scheduleSave(edited);
    });

    await act(async () => {
      release({
        text: serialize(snap("the long desktop note")),
        revision: "r9",
      });
    });

    expect(result.current.conflict).not.toBeNull();
    expect(result.current.conflict!.remote.notes[0]!.body).toBe(
      "the long desktop note",
    );
    expect(result.current.status).toBe("conflict");
    // And the on-screen edit is still there to be kept if the user says so.
    expect(result.current.doc.notes[0]!.body).toBe(
      "typed before the first load landed",
    );
  });

  it("adopts the loaded document normally when nothing raced the load", async () => {
    const saves: { text: string; base?: string }[] = [];
    const { adapter, release } = gatedAdapter({
      seed: { text: serialize(snap("stale mirror")), revision: "r1" },
      saves,
    });

    const { result } = renderHook(() => useNotesSync({ active: adapter }));
    await act(async () => {
      release({
        text: serialize(snap("fresh from the cloud")),
        revision: "r9",
      });
    });

    expect(result.current.conflict).toBeNull();
    expect(result.current.doc.notes[0]!.body).toBe("fresh from the cloud");

    const edited = snap("edited after the load");
    act(() => {
      result.current.setDoc(edited);
      result.current.scheduleSave(edited);
    });
    expect(saves.at(-1)!.base).toBe("r9");
  });
});

describe("useNotesSync unsynced mirror", () => {
  it("re-queues edits the mirror says never reached the backend", async () => {
    // The app was closed while offline with an unsaved edit. On the next launch
    // the mirror is the only record of it, so the engine must push it — based
    // on the last revision the backend confirmed, not on the mirror's text.
    const saves: { text: string; base?: string }[] = [];
    const { adapter, release } = gatedAdapter({
      seed: {
        text: serialize(snap("written on the train")),
        revision: "r1",
        pending: true,
      },
      saves,
    });

    const { result } = renderHook(() => useNotesSync({ active: adapter }));
    expect(result.current.dirty).toBe(true);
    expect(result.current.doc.notes[0]!.body).toBe("written on the train");

    await act(async () => {
      release({ text: serialize(snap("what the cloud has")), revision: "r1" });
    });

    expect(saves).toHaveLength(1);
    expect(saves[0]!.base).toBe("r1");
    expect(saves[0]!.text).toContain("written on the train");
    // The load must not have replaced the unsynced work on screen.
    expect(result.current.doc.notes[0]!.body).toBe("written on the train");
  });

  it("leaves a synced mirror alone", async () => {
    const saves: { text: string; base?: string }[] = [];
    const { adapter, release } = gatedAdapter({
      seed: { text: serialize(snap("all synced")), revision: "r1" },
      saves,
    });

    const { result } = renderHook(() => useNotesSync({ active: adapter }));
    expect(result.current.dirty).toBe(false);

    await act(async () => {
      release({ text: serialize(snap("all synced")), revision: "r1" });
    });
    expect(saves).toHaveLength(0);
  });
});
