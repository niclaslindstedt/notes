// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  FolderEditRow,
  FolderRow,
  NavItem,
  SectionHeader,
  SwipeToRemove,
} from "../../src/ui/SideMenuRows.tsx";
import { NOTE_DROP_ATTR } from "../../src/ui/note-drag-context.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // `vi.restoreAllMocks()` does not undo `vi.stubGlobal`, so a desktop test's
  // `matchMedia` stub would otherwise leak into the next (touch) test.
  vi.unstubAllGlobals();
});

// `FolderRow` / `SwipeToRemove` read `useMediaQuery("(hover: hover) and
// (pointer: fine)")` to pick the desktop right-click menu over the touch swipe
// strip. jsdom has no `matchMedia`, so stub it per test (unstubbed → touch).
function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
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

describe("SectionHeader", () => {
  it("toggles a collapsible section and reflects collapsed via aria-expanded", () => {
    const onToggle = vi.fn();
    render(
      <SectionHeader
        label="Namespaces"
        collapsible
        collapsed
        onToggle={onToggle}
        toggleLabel="Expand namespaces"
      />,
    );
    const toggle = screen.getByRole("button", { name: "Expand namespaces" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("fires the trailing add action", () => {
    const onAdd = vi.fn();
    render(<SectionHeader label="Notes" onAdd={onAdd} addLabel="New note" />);
    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});

describe("NavItem", () => {
  it("marks the active row with aria-current and fires onClick", () => {
    const onClick = vi.fn();
    render(<NavItem icon={null} label="Default" active onClick={onClick} />);
    const row = screen.getByRole("menuitem", { name: "Default" });
    expect(row.getAttribute("aria-current")).toBe("page");
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows the trailing badge only when one is passed", () => {
    render(
      <NavItem
        icon={null}
        label="Archive"
        active={false}
        badge={3}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText("3")).toBeTruthy();
    cleanup();
    render(
      <NavItem icon={null} label="Archive" active={false} onClick={vi.fn()} />,
    );
    expect(screen.queryByText("3")).toBeNull();
  });

  it("renders disabled rows inert", () => {
    const onClick = vi.fn();
    render(
      <NavItem
        icon={null}
        label="Undo"
        active={false}
        disabled
        onClick={onClick}
      />,
    );
    const row = screen.getByRole("menuitem", {
      name: "Undo",
    }) as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    fireEvent.click(row);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("wires the drop-target attribute and HTML5 handlers when droppable", () => {
    const onDragOver = vi.fn();
    const onDrop = vi.fn();
    render(
      <NavItem
        icon={null}
        label="Work"
        active={false}
        onClick={vi.fn()}
        dropId="ns:work"
        onDragOver={onDragOver}
        onDrop={onDrop}
      />,
    );
    const row = screen.getByRole("menuitem", { name: "Work" });
    expect(row.getAttribute(NOTE_DROP_ATTR)).toBe("ns:work");
    fireEvent.dragOver(row);
    fireEvent.drop(row);
    expect(onDragOver).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });
});

describe("FolderEditRow", () => {
  it("commits a trimmed name on Enter", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <FolderEditRow
        placeholder="Folder name"
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Folder name" });
    fireEvent.change(input, { target: { value: "  Recipes  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("Recipes");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels an empty name on blur (so a never-named folder vanishes)", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <FolderEditRow
        placeholder="Folder name"
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );
    fireEvent.blur(screen.getByRole("textbox", { name: "Folder name" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("cancels on Escape without committing the seeded value", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <FolderEditRow
        initial="Travel"
        placeholder="Folder name"
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Folder name" }), {
      key: "Escape",
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

function folderRowProps(
  overrides: Partial<Parameters<typeof FolderRow>[0]> = {},
) {
  return {
    name: "Recipes",
    count: 0,
    expanded: false,
    containsActiveNote: false,
    isDropTarget: false,
    renameLabel: "Rename folder",
    deleteLabel: "Delete folder",
    addNoteLabel: "New note",
    onToggle: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onAddNote: vi.fn(),
    onDragOver: vi.fn(),
    onDragLeave: vi.fn(),
    onDrop: vi.fn(),
    ...overrides,
  };
}

describe("FolderRow", () => {
  it("toggles on the label and starts a note from the trailing +", () => {
    const props = folderRowProps({ count: 2 });
    render(<FolderRow {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Recipes/ }));
    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    expect(props.onToggle).toHaveBeenCalledTimes(1);
    expect(props.onAddNote).toHaveBeenCalledTimes(1);
    // The note count rides a pill, hidden at zero.
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("hides the count pill when the folder is empty", () => {
    render(<FolderRow {...folderRowProps({ count: 0 })} />);
    expect(screen.queryByText("0")).toBeNull();
  });

  it("exposes rename/delete in the touch swipe strip", () => {
    stubMatchMedia(false);
    const props = folderRowProps();
    render(<FolderRow {...props} />);
    // The strip starts `aria-hidden` (the row hasn't been swiped), so it is
    // outside the accessibility tree until revealed — query it with `hidden`.
    fireEvent.click(
      screen.getByRole("button", { name: "Rename folder", hidden: true }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete folder", hidden: true }),
    );
    expect(props.onRename).toHaveBeenCalledTimes(1);
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });

  it("offers rename/delete via the right-click menu on desktop", () => {
    stubMatchMedia(true);
    const props = folderRowProps();
    render(<FolderRow {...props} />);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(screen.getByText("Recipes"));
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "Rename folder",
      "Delete folder",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete folder" }));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });
});

describe("SwipeToRemove", () => {
  it("deletes from the trailing trash button on touch", () => {
    stubMatchMedia(false);
    const onRemove = vi.fn();
    render(
      <SwipeToRemove
        actionLabel="Delete note"
        archiveLabel="Archive"
        onRemove={onRemove}
        onArchive={vi.fn()}
      >
        <div>Groceries</div>
      </SwipeToRemove>,
    );
    expect(screen.getByText("Groceries")).toBeTruthy();
    // The trash button rides the `aria-hidden` strip until a left swipe latches
    // it open, so it is outside the accessibility tree — query with `hidden`.
    fireEvent.click(
      screen.getByRole("button", { name: "Delete note", hidden: true }),
    );
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("offers archive + delete via the right-click menu on desktop", () => {
    stubMatchMedia(true);
    const onRemove = vi.fn();
    const onArchive = vi.fn();
    render(
      <SwipeToRemove
        actionLabel="Delete note"
        archiveLabel="Archive"
        onRemove={onRemove}
        onArchive={onArchive}
      >
        <div>Groceries</div>
      </SwipeToRemove>,
    );
    fireEvent.contextMenu(screen.getByText("Groceries"));
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Archive", "Delete note"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onRemove).not.toHaveBeenCalled();
  });
});
