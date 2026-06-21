// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SyncDetailsModal } from "../../src/ui/SyncDetailsModal.tsx";
import type { EncryptionConversionState } from "../../src/ui/settings/EncryptionLogModal.tsx";

const IDLE_CONVERSION: EncryptionConversionState = {
  busy: false,
  direction: null,
  message: null,
  done: 0,
  total: 0,
  error: null,
  log: [],
};

function renderModal(props: Partial<Parameters<typeof SyncDetailsModal>[0]>) {
  render(
    <SyncDetailsModal
      open
      backend="dropbox"
      namespace="default"
      providerName="Dropbox"
      status="saved"
      statusDetail={null}
      dirty={false}
      offline={false}
      onSaveNow={vi.fn()}
      onReload={vi.fn()}
      onReconnect={vi.fn(() => Promise.resolve())}
      onClose={vi.fn()}
      {...props}
    />,
  );
}

describe("SyncDetailsModal", () => {
  it("names the bare provider in the open-in link, without the (encrypted) suffix", () => {
    renderModal({ providerName: "Dropbox (encrypted)" });
    const link = screen.getByRole("link", { name: /open in/i });
    expect(link.textContent).toContain("Open in Dropbox");
    expect(link.textContent).not.toContain("(encrypted)");
  });

  it("leaves a plaintext provider name untouched in the open-in link", () => {
    renderModal({ providerName: "Dropbox" });
    const link = screen.getByRole("link", { name: /open in/i });
    expect(link.textContent).toContain("Open in Dropbox");
  });

  it("strips the (encrypted) suffix from the status copy too", () => {
    renderModal({ providerName: "Dropbox (encrypted)", encrypted: true });
    // The status heading reads the bare service name; the dedicated
    // Encryption column carries the at-rest state instead.
    expect(screen.getByText("Synced to Dropbox")).toBeTruthy();
  });

  it("shows the encryption state in the details grid", () => {
    renderModal({ encrypted: true });
    expect(screen.getByText("On")).toBeTruthy();
  });

  it("lists the notes uploading right now", () => {
    renderModal({
      status: "saving",
      uploads: [
        { id: "a", title: "Grocery list" },
        { id: "b", title: "Trip plan" },
      ],
    });
    expect(screen.getByText("Grocery list")).toBeTruthy();
    expect(screen.getByText("Trip plan")).toBeTruthy();
  });

  it("surfaces the live encryption conversion progress", () => {
    renderModal({
      conversion: {
        ...IDLE_CONVERSION,
        busy: true,
        direction: "encrypt",
        message: "Encrypting attachment diagram.png",
        done: 3,
        total: 8,
      },
    });
    expect(screen.getByText("Encrypting attachment diagram.png")).toBeTruthy();
    expect(screen.getByText("3 of 8")).toBeTruthy();
  });

  it("surfaces a stopped conversion's error", () => {
    renderModal({
      conversion: {
        ...IDLE_CONVERSION,
        error: "Network request failed",
      },
    });
    expect(screen.getByText("Network request failed")).toBeTruthy();
  });
});
