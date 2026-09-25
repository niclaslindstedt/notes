// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";

import { DeadSpaceMenu } from "../../src/ui/DeadSpaceMenu.tsx";
import { RowActionMenu } from "../../src/ui/RowActionMenu.tsx";
import { drain, resetBus } from "../../src/achievements/bus.ts";

afterEach(() => {
  cleanup();
  resetBus();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// `useDesktopPointer()` reads `matchMedia`, which jsdom can't answer.
function stubPointer(desktop: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: desktop,
      media: "",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    })),
  );
}

function renderSurface(onNewDropzone?: () => void) {
  const onNewNote = vi.fn();
  render(
    <DeadSpaceMenu onNewNote={onNewNote} onNewDropzone={onNewDropzone}>
      <p>Empty space</p>
      <RowActionMenu actions={[{ label: "Archive", onSelect: vi.fn() }]}>
        <div>A note row</div>
      </RowActionMenu>
      <button type="button">A button</button>
    </DeadSpaceMenu>,
  );
  return { onNewNote };
}

describe("DeadSpaceMenu", () => {
  it("offers New note on a right-click in empty space", () => {
    stubPointer(true);
    const { onNewNote } = renderSurface();

    const event = fireEvent.contextMenu(screen.getByText("Empty space"));
    expect(event).toBe(false);
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["New note"]);

    fireEvent.click(items[0]!);
    expect(onNewNote).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(drain()).toContain("outOfThinAir");
  });

  it("adds a dropzone entry when dropzone notes are available", () => {
    stubPointer(true);
    const onNewDropzone = vi.fn();
    renderSurface(onNewDropzone);

    fireEvent.contextMenu(screen.getByText("Empty space"));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "New dropzone note" }),
    );
    expect(onNewDropzone).toHaveBeenCalledTimes(1);
  });

  it("lets a row's own menu claim its right-click", () => {
    stubPointer(true);
    renderSurface();

    fireEvent.contextMenu(screen.getByText("A note row"));
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Archive"]);
  });

  it("leaves the native menu on buttons and on touch devices", () => {
    stubPointer(true);
    renderSurface();
    expect(fireEvent.contextMenu(screen.getByText("A button"))).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
    cleanup();

    stubPointer(false);
    renderSurface();
    expect(fireEvent.contextMenu(screen.getByText("Empty space"))).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
