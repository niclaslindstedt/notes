// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SyncDetailsModal } from "../../src/ui/SyncDetailsModal.tsx";

function renderModal(providerName: string) {
  render(
    <SyncDetailsModal
      open
      backend="dropbox"
      namespace="default"
      providerName={providerName}
      status="saved"
      statusDetail={null}
      dirty={false}
      offline={false}
      onSaveNow={vi.fn()}
      onReload={vi.fn()}
      onReconnect={vi.fn(() => Promise.resolve())}
      onClose={vi.fn()}
    />,
  );
}

describe("SyncDetailsModal", () => {
  it("names the bare provider in the open-in link, without the (encrypted) suffix", () => {
    renderModal("Dropbox (encrypted)");
    const link = screen.getByRole("link", { name: /open in/i });
    expect(link.textContent).toContain("Open in Dropbox");
    expect(link.textContent).not.toContain("(encrypted)");
  });

  it("leaves a plaintext provider name untouched in the open-in link", () => {
    renderModal("Dropbox");
    const link = screen.getByRole("link", { name: /open in/i });
    expect(link.textContent).toContain("Open in Dropbox");
  });
});
