// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SideMenuActionBar } from "../../src/ui/SideMenuActionBar.tsx";
import { NOTE_DROP_ARCHIVE } from "../../src/ui/note-drag-context.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// `useT` falls back to the English defaults on its own, so the bar needs no
// provider — the icon-only buttons surface their label via `aria-label`.
function renderBar(
  overrides: Partial<Parameters<typeof SideMenuActionBar>[0]> = {},
) {
  const props = {
    onNewNote: vi.fn(),
    onNewFolder: vi.fn(),
    onShowAll: vi.fn(),
    showAllActive: false,
    onOpenArchive: vi.fn(),
    archiveActive: false,
    archivedCount: 0,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    canUndo: true,
    canRedo: true,
    archiveIsDropTarget: false,
    onArchiveDragOver: vi.fn(),
    onArchiveDragLeave: vi.fn(),
    onArchiveDrop: vi.fn(),
    ...overrides,
  };
  render(<SideMenuActionBar {...props} />);
  return props;
}

describe("SideMenuActionBar", () => {
  it("fires the create/navigate callbacks", () => {
    const props = renderBar();
    fireEvent.click(screen.getByRole("menuitem", { name: "New note" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "New folder" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Show all" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(props.onNewNote).toHaveBeenCalledTimes(1);
    expect(props.onNewFolder).toHaveBeenCalledTimes(1);
    expect(props.onShowAll).toHaveBeenCalledTimes(1);
    expect(props.onOpenArchive).toHaveBeenCalledTimes(1);
  });

  it("marks the active view with aria-current", () => {
    renderBar({ showAllActive: true, archiveActive: false });
    expect(
      screen
        .getByRole("menuitem", { name: "Show all" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen
        .getByRole("menuitem", { name: "Archive" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("shows the archived-note count as a badge, hidden at zero", () => {
    renderBar({ archivedCount: 0 });
    expect(screen.queryByText("0")).toBeNull();
    cleanup();
    renderBar({ archivedCount: 4 });
    expect(screen.getByText("4")).not.toBeNull();
  });

  it("disables undo / redo at the ends of the timeline and fires them otherwise", () => {
    const props = renderBar({ canUndo: false, canRedo: true });
    const undo = screen.getByRole("menuitem", { name: "Undo" });
    const redo = screen.getByRole("menuitem", { name: "Redo" });
    expect((undo as HTMLButtonElement).disabled).toBe(true);
    expect((redo as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(undo);
    fireEvent.click(redo);
    expect(props.onUndo).not.toHaveBeenCalled();
    expect(props.onRedo).toHaveBeenCalledTimes(1);
  });

  it("wires the Archive cell as a drop target", () => {
    const props = renderBar();
    const archive = screen.getByRole("menuitem", { name: "Archive" });
    expect(archive.getAttribute("data-note-drop")).toBe(NOTE_DROP_ARCHIVE);
    fireEvent.dragOver(archive);
    fireEvent.drop(archive);
    expect(props.onArchiveDragOver).toHaveBeenCalledTimes(1);
    expect(props.onArchiveDrop).toHaveBeenCalledTimes(1);
  });
});
