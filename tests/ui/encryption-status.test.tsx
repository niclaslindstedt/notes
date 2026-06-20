// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EncryptionConversionState } from "../../src/ui/settings/EncryptionLogModal.tsx";
import { StorageSection } from "../../src/ui/settings/StorageSection.tsx";
import type { UseStorageBackend } from "../../src/storage/useStorageBackend.ts";

// A minimal storage stub — StorageSection only reads these fields to draw the
// browser backend + the encryption toggle.
function stubStorage(over: Partial<UseStorageBackend> = {}): UseStorageBackend {
  return {
    backend: "folder",
    dropboxConfigured: false,
    gdriveConfigured: false,
    dropboxConnected: false,
    gdriveConnected: false,
    folderAvailable: true,
    folderConnected: true,
    folderReconnectNeeded: false,
    encryption: "encrypted",
    selectBrowser: vi.fn(),
    connectFolder: vi.fn(() => Promise.resolve()),
    reconnectFolder: vi.fn(() => Promise.resolve()),
    disconnectFolder: vi.fn(() => Promise.resolve()),
    connectDropbox: vi.fn(),
    disconnectDropbox: vi.fn(),
    connectGdrive: vi.fn(() => Promise.resolve()),
    disconnectGdrive: vi.fn(),
    enableEncryption: vi.fn(() => Promise.resolve()),
    disableEncryption: vi.fn(() => Promise.resolve()),
    ...over,
  } as unknown as UseStorageBackend;
}

const idleConversion: EncryptionConversionState = {
  busy: false,
  direction: null,
  message: null,
  done: 0,
  total: 0,
  error: null,
  log: [],
};

describe("encryption status bar", () => {
  it("flashes the per-note conversion message and invites closing settings", () => {
    const conversion: EncryptionConversionState = {
      ...idleConversion,
      busy: true,
      direction: "encrypt",
      message: 'Encrypting "Groceries"…',
      done: 1,
      total: 3,
    };
    render(<StorageSection storage={stubStorage()} conversion={conversion} />);

    const status = screen.getByRole("status");
    expect(status.textContent).toContain('Encrypting "Groceries"…');
    expect(status.textContent).toMatch(/close settings/i);
  });

  it("shows no status bar when the conversion is idle", () => {
    render(
      <StorageSection storage={stubStorage()} conversion={idleConversion} />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("surfaces a failed conversion as a tappable error", () => {
    const conversion: EncryptionConversionState = {
      ...idleConversion,
      error: "Backend is unreachable",
      log: [{ text: "Backend is unreachable", ts: Date.now(), level: "error" }],
    };
    render(<StorageSection storage={stubStorage()} conversion={conversion} />);
    // The red status line is a button (opens the log modal).
    expect(
      screen.getByRole("button", { name: /something went wrong/i }),
    ).toBeTruthy();
  });
});
