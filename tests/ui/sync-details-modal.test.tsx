// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clearLogs, createLogger, getLogs } from "../../src/dev/logger.ts";
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

// The sync log reads the shared in-memory buffer, so each test starts from an
// empty one and copies through a stubbed clipboard.
const writeText = vi.fn<(text: string) => Promise<void>>(() =>
  Promise.resolve(),
);

Object.defineProperty(navigator, "clipboard", {
  value: { writeText },
  configurable: true,
});

afterEach(() => {
  clearLogs();
  writeText.mockClear();
  vi.restoreAllMocks();
});

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

  it("offers the copy ranges, each labelled with how much it would copy", () => {
    const log = createLogger("notes-sync");
    log.info("save start");
    log.info("save ok");
    renderModal({});

    fireEvent.click(screen.getByRole("button", { name: /view sync log/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Copy/ }));

    const rows = screen.getAllByRole("menuitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      "Last 10 minutes2 lines",
      "Last 30 minutes2 lines",
      "Last hour2 lines",
      "Everything2 lines",
    ]);
  });

  it("copies the picked range oldest-first", async () => {
    const log = createLogger("notes-sync");
    log.info("save start");
    log.info("save ok");
    renderModal({});

    fireEvent.click(screen.getByRole("button", { name: /view sync log/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Copy/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Last hour/ }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = writeText.mock.calls[0]![0] as string;
    const lines = text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("[notes-sync] INFO save start");
    expect(lines[1]).toContain("[notes-sync] INFO save ok");
    // The menu closes on the press and the trigger confirms in place.
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(screen.getByRole("button", { name: /Copied/ })).toBeTruthy();
  });

  it("disables a range no log line falls into", () => {
    const log = createLogger("notes-sync");
    log.info("save ok");
    // Pretend the one entry is two hours old: only "Everything" still reaches
    // it, and an enabled row that copies nothing would be a lie.
    const buffer = getLogs();
    vi.spyOn(Date, "now").mockReturnValue(buffer[0]!.ts + 2 * 60 * 60_000);
    renderModal({});

    fireEvent.click(screen.getByRole("button", { name: /view sync log/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Copy/ }));

    const rows = screen.getAllByRole("menuitem") as HTMLButtonElement[];
    expect(rows.slice(0, 3).every((r) => r.disabled)).toBe(true);
    expect(rows[3]!.disabled).toBe(false);
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
