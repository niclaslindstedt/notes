// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UnlockGate } from "../../src/ui/UnlockGate.tsx";
import type {
  EncryptionProgress,
  UseStorageBackend,
} from "../../src/storage/useStorageBackend.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("unlock gate status feedback", () => {
  it("flashes what's happening and disables the button while unlocking", async () => {
    const gate = deferred<void>();
    const unlock = vi.fn((_pass: string, onProgress?: EncryptionProgress) => {
      // The storage layer brackets the load with these phases; the gate maps
      // the last one to the status line shown during the wait.
      onProgress?.("derivingKey");
      onProgress?.("decrypting");
      return gate.promise;
    });
    const storage = { unlock } as unknown as UseStorageBackend;

    render(<UnlockGate storage={storage} />);

    fireEvent.change(screen.getByLabelText("Passphrase"), {
      target: { value: "hunter2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Decrypting your notes…");
    expect(unlock).toHaveBeenCalledWith("hunter2", expect.any(Function));
    expect(
      (screen.getByRole("button", { name: "Unlock" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    gate.resolve();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("names the phases in unlock-specific terms", async () => {
    const gate = deferred<void>();
    const unlock = vi.fn((_pass: string, onProgress?: EncryptionProgress) => {
      onProgress?.("derivingKey");
      return gate.promise;
    });
    const storage = { unlock } as unknown as UseStorageBackend;

    render(<UnlockGate storage={storage} />);
    fireEvent.change(screen.getByLabelText("Passphrase"), {
      target: { value: "hunter2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    const status = await screen.findByRole("status");
    // Not the generic "Deriving encryption key…" the encryption toggle uses.
    expect(status.textContent).toContain("Checking your passphrase…");

    gate.resolve();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("names each note as the file backend decrypts it", async () => {
    const gate = deferred<void>();
    const unlock = vi.fn((_pass: string, onProgress?: EncryptionProgress) => {
      onProgress?.("decrypting");
      onProgress?.("decrypting", { title: "Groceries", index: 2, total: 5 });
      return gate.promise;
    });
    const storage = { unlock } as unknown as UseStorageBackend;

    render(<UnlockGate storage={storage} />);
    fireEvent.change(screen.getByLabelText("Passphrase"), {
      target: { value: "hunter2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Groceries");
    expect(status.textContent).toContain("(2/5)");

    gate.resolve();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("falls back to a placeholder for an untitled note", async () => {
    const gate = deferred<void>();
    const unlock = vi.fn((_pass: string, onProgress?: EncryptionProgress) => {
      onProgress?.("decrypting", { title: "", index: 1, total: 1 });
      return gate.promise;
    });
    const storage = { unlock } as unknown as UseStorageBackend;

    render(<UnlockGate storage={storage} />);
    fireEvent.change(screen.getByLabelText("Passphrase"), {
      target: { value: "hunter2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Untitled note");

    gate.resolve();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("shows no status bar before unlock is pressed", () => {
    const storage = {
      unlock: vi.fn(() => Promise.resolve()),
    } as unknown as UseStorageBackend;
    render(<UnlockGate storage={storage} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
