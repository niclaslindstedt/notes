// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useNotesSync } from "../../src/app/use-notes-sync.ts";
import {
  EncryptedRemoteError,
  type StorageAdapter,
  type StoredSnapshot,
} from "../../src/storage/adapter.ts";
import { serialize } from "../../src/storage/serialize.ts";

describe("useNotesSync — encrypted-remote handoff", () => {
  it("calls onEncryptedRemote when the initial load finds an encrypted backend", async () => {
    const onEncryptedRemote = vi.fn();
    // A cloud-shaped adapter whose async `load` rejects with
    // EncryptedRemoteError — the signal a plaintext-mode device raises when the
    // folder it syncs turns out to hold encrypted notes. Built once so its
    // identity is stable across renders (a fresh adapter each render would
    // re-arm the load effect in a loop).
    const active: StorageAdapter = {
      id: "dropbox",
      label: "Encrypted remote",
      capabilities: new Set(),
      load: async (): Promise<StoredSnapshot | null> => {
        throw new EncryptedRemoteError();
      },
      save: async (text: string) => ({ text }),
    };
    renderHook(() => useNotesSync({ active, onEncryptedRemote }));
    await waitFor(() => expect(onEncryptedRemote).toHaveBeenCalledTimes(1));
  });

  it("calls onEncryptedRemote when a later reload finds the backend became encrypted", async () => {
    const onEncryptedRemote = vi.fn();
    // First load succeeds (plaintext) so the app runs normally; only the later
    // reload (a live pull) surfaces the encryption another device turned on.
    let encrypted = false;
    const active: StorageAdapter = {
      id: "dropbox",
      label: "Turns encrypted",
      capabilities: new Set(),
      load: async (): Promise<StoredSnapshot | null> => {
        if (encrypted) throw new EncryptedRemoteError();
        return { text: serialize({ notes: [] }), revision: "r1" };
      },
      save: async (text: string) => ({ text }),
    };
    const { result } = renderHook(() =>
      useNotesSync({ active, onEncryptedRemote }),
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(onEncryptedRemote).not.toHaveBeenCalled();

    encrypted = true;
    await act(async () => {
      await result.current.reload();
    });
    expect(onEncryptedRemote).toHaveBeenCalledTimes(1);
  });
});
