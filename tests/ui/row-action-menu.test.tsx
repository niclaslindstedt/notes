// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { RowActionMenu } from "../../src/ui/RowActionMenu.tsx";
import { resetBus } from "../../src/achievements/bus.ts";

afterEach(() => {
  cleanup();
  resetBus();
  vi.restoreAllMocks();
});

describe("RowActionMenu", () => {
  it("opens a menu of actions on right-click and fires the chosen one", () => {
    const archive = vi.fn();
    const remove = vi.fn();
    render(
      <RowActionMenu
        ariaLabel="Note actions"
        actions={[
          { label: "Archive", onSelect: archive },
          { label: "Delete", onSelect: remove, danger: true },
        ]}
      >
        <button type="button">Open note</button>
      </RowActionMenu>,
    );

    // No menu until the row is right-clicked.
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(screen.getByText("Open note"));

    const menu = screen.getByRole("menu", { name: "Note actions" });
    expect(menu).toBeTruthy();
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Archive", "Delete"]);

    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(archive).not.toHaveBeenCalled();
    // The menu closes after committing an action.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("leaves the native menu alone when disabled", () => {
    const archive = vi.fn();
    render(
      <RowActionMenu
        enabled={false}
        actions={[{ label: "Archive", onSelect: archive }]}
      >
        <button type="button">Open note</button>
      </RowActionMenu>,
    );

    const event = fireEvent.contextMenu(screen.getByText("Open note"));
    // The event isn't intercepted (default not prevented), so the browser's
    // own context menu shows and ours stays shut.
    expect(event).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("commits the highlighted action via the keyboard", () => {
    const archive = vi.fn();
    const remove = vi.fn();
    render(
      <RowActionMenu
        actions={[
          { label: "Archive", onSelect: archive },
          { label: "Delete", onSelect: remove, danger: true },
        ]}
      >
        <button type="button">Open note</button>
      </RowActionMenu>,
    );

    fireEvent.contextMenu(screen.getByText("Open note"));
    const menu = screen.getByRole("menu");
    // ArrowDown moves the highlight onto the first item, again onto the
    // second, then Enter commits it.
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
