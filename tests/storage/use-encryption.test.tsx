// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  StorageAdapter,
  StoredSnapshot,
} from "../../src/storage/adapter.ts";
import { OfflineUnavailableError } from "../../src/storage/cache/index.ts";
import {
  decryptEnvelope,
  isEncryptedEnvelope,
} from "../../src/storage/crypto.ts";
import { parse, serialize } from "../../src/storage/serialize.ts";
import {
  hydrateForSwitch,
  useEncryption,
} from "../../src/storage/useEncryption.ts";

// A minimal in-memory adapter that records what the verbs ask of it. The
// browser-backend encryption verbs only ever call `load` / `save` (and
// `hydrateForSwitch` calls `fetchAttachment`); everything else is unused here.
function fakeAdapter(
  over: Partial<StorageAdapter> & { initial?: StoredSnapshot | null } = {},
): StorageAdapter & { saves: Array<{ text: string; revision?: unknown }> } {
  const saves: Array<{ text: string; revision?: unknown }> = [];
  let current = over.initial ?? null;
  return {
    id: "browser",
    label: "Fake",
    capabilities: new Set(),
    async load() {
      return current;
    },
    async save(text: string, revision?: string) {
      saves.push({ text, revision });
      current = { text, revision };
      return current;
    },
    ...over,
    saves,
  };
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("hydrateForSwitch", () => {
  it("pulls every unloaded attachment's bytes into the snapshot", async () => {
    const text = serialize({
      notes: [
        {
          id: "n1",
          title: "With image",
          body: "see ![](attachments/a.png)",
          createdAt: 1,
          updatedAt: 2,
          attachments: [{ filename: "a.png", mime: "image/png" }],
        },
      ],
      folders: [],
    });
    const inner = fakeAdapter({
      async fetchAttachment() {
        return { mime: "image/png", bytes: new Uint8Array([1, 2, 3]) };
      },
    });
    const out = parse(await hydrateForSwitch(inner, text));
    expect(out.notes[0]?.attachments?.[0]?.data).toMatch(/^data:image\/png/);
  });

  it("leaves an already-hydrated attachment untouched and fetches nothing", async () => {
    const text = serialize({
      notes: [
        {
          id: "n1",
          title: "Has data",
          body: "x",
          createdAt: 1,
          updatedAt: 2,
          attachments: [
            {
              filename: "a.png",
              mime: "image/png",
              data: "data:image/png;base64,AA",
            },
          ],
        },
      ],
      folders: [],
    });
    const fetchAttachment = vi.fn();
    const inner = fakeAdapter({ fetchAttachment });
    const out = parse(await hydrateForSwitch(inner, text));
    expect(out.notes[0]?.attachments?.[0]?.data).toBe(
      "data:image/png;base64,AA",
    );
    expect(fetchAttachment).not.toHaveBeenCalled();
  });
});

describe("useEncryption (browser backend)", () => {
  it("enableEncryption re-saves through the wrapper and flips the mode on", async () => {
    const doc = serialize({
      notes: [{ id: "n1", title: "T", body: "b", createdAt: 1, updatedAt: 2 }],
      folders: [],
    });
    const inner = fakeAdapter({ initial: { text: doc, revision: "r1" } });
    const innerRef = { current: inner as StorageAdapter };
    const { result } = renderHook(() => useEncryption(innerRef, "browser"));
    expect(result.current.locked).toBe(false);

    const steps: string[] = [];
    await act(async () => {
      await result.current.enableEncryption("pw", (s) => steps.push(s));
    });

    expect(inner.saves).toHaveLength(1);
    // Re-saved against the loaded revision.
    expect(inner.saves[0]?.revision).toBe("r1");
    // The bytes land encrypted at rest — not plaintext waiting for the next
    // edit — and decrypt back to the original note.
    const savedText = inner.saves[0]!.text;
    expect(isEncryptedEnvelope(savedText)).toBe(true);
    expect(
      parse(await decryptEnvelope(savedText, "pw")).notes[0],
    ).toMatchObject({
      id: "n1",
      title: "T",
      body: "b",
    });
    expect(result.current.encryption).toBe("encrypted");
    expect(result.current.locked).toBe(false);
    expect(steps).toEqual([
      "reading",
      "derivingKey",
      "encrypting",
      "saving",
      "finalizing",
    ]);
  });

  it("enableEncryption rejects an empty passphrase without touching the store", async () => {
    const inner = fakeAdapter({ initial: { text: "doc" } });
    const innerRef = { current: inner as StorageAdapter };
    const { result } = renderHook(() => useEncryption(innerRef, "browser"));
    await expect(result.current.enableEncryption("")).rejects.toThrow(
      /Passphrase is required/,
    );
    expect(inner.saves).toHaveLength(0);
    expect(result.current.encryption).toBe("plaintext");
  });

  it("disableEncryption decrypts and re-saves as plaintext without losing the notes", async () => {
    const doc = serialize({
      notes: [{ id: "n1", title: "T", body: "b", createdAt: 1, updatedAt: 2 }],
      folders: [],
    });
    const inner = fakeAdapter({ initial: { text: doc, revision: "r1" } });
    const innerRef = { current: inner as StorageAdapter };
    const { result } = renderHook(() => useEncryption(innerRef, "browser"));

    await act(async () => {
      await result.current.enableEncryption("pw");
    });
    // Enable actually encrypted the document at rest.
    expect(isEncryptedEnvelope(inner.saves.at(-1)!.text)).toBe(true);

    await act(async () => {
      await result.current.disableEncryption();
    });

    expect(result.current.encryption).toBe("plaintext");
    expect(result.current.locked).toBe(false);
    // Once to seal on enable, once to re-save plaintext on disable.
    expect(inner.saves).toHaveLength(2);
    // Regression: disabling must decrypt the ciphertext first, not overwrite it
    // with an empty document parsed from the raw envelope.
    const finalText = inner.saves.at(-1)!.text;
    expect(isEncryptedEnvelope(finalText)).toBe(false);
    expect(parse(finalText).notes[0]).toMatchObject({
      id: "n1",
      title: "T",
      body: "b",
    });
  });

  it("disableEncryption refuses to run while locked (no passphrase held)", async () => {
    localStorage.setItem("notes:encryption", "encrypted");
    const inner = fakeAdapter({ initial: { text: "doc" } });
    const innerRef = { current: inner as StorageAdapter };
    const { result } = renderHook(() => useEncryption(innerRef, "browser"));
    expect(result.current.locked).toBe(true);
    await expect(result.current.disableEncryption()).rejects.toThrow(
      /Unlock before turning encryption off/,
    );
    expect(inner.saves).toHaveLength(0);
  });

  it("unlock surfaces a bad passphrase as 'Wrong password' and stays locked", async () => {
    localStorage.setItem("notes:encryption", "encrypted");
    const inner = fakeAdapter({
      async load() {
        throw new Error("wrong password");
      },
    });
    const innerRef = { current: inner as StorageAdapter };
    const { result } = renderHook(() => useEncryption(innerRef, "browser"));
    await expect(result.current.unlock("nope")).rejects.toThrow(
      /Wrong password/,
    );
    expect(result.current.locked).toBe(true);
  });

  it("unlock maps an unreachable backend to an offline error", async () => {
    localStorage.setItem("notes:encryption", "encrypted");
    const inner = fakeAdapter({
      async load() {
        throw new Error("network down");
      },
    });
    const innerRef = { current: inner as StorageAdapter };
    const { result } = renderHook(() => useEncryption(innerRef, "browser"));
    await expect(result.current.unlock("pw")).rejects.toBeInstanceOf(
      OfflineUnavailableError,
    );
    expect(result.current.locked).toBe(true);
  });

  it("unlock with the right passphrase clears the locked gate", async () => {
    localStorage.setItem("notes:encryption", "encrypted");
    const inner = fakeAdapter({ initial: { text: "doc" } });
    const innerRef = { current: inner as StorageAdapter };
    const { result } = renderHook(() => useEncryption(innerRef, "browser"));
    expect(result.current.locked).toBe(true);
    await act(async () => {
      await result.current.unlock("pw");
    });
    expect(result.current.locked).toBe(false);
    expect(result.current.encryption).toBe("encrypted");
  });

  it("seal / unseal pass through untouched while no passphrase is held", async () => {
    const inner = fakeAdapter();
    const innerRef = { current: inner as StorageAdapter };
    const { result } = renderHook(() => useEncryption(innerRef, "browser"));
    await expect(result.current.seal("hello")).resolves.toBe("hello");
    await expect(result.current.unseal("hello")).resolves.toBe("hello");
  });
});
