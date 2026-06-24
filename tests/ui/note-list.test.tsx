// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { NoteList } from "../../src/ui/note-list/NoteList.tsx";
import type { Folder, Note } from "../../src/domain/note.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "n1",
    title: "Groceries",
    body: "Milk\nEggs",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function folder(overrides: Partial<Folder> = {}): Folder {
  return { id: "f1", name: "Work", createdAt: 0, ...overrides };
}

// `NoteList` reads `useMediaQuery("(hover: hover) and (pointer: fine)")` to pick
// the desktop vs touch affordances; jsdom has no `matchMedia`, so stub it.
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

function renderList(props: Partial<Parameters<typeof NoteList>[0]> = {}) {
  const handlers = {
    onOpen: vi.fn(),
    onNew: vi.fn(),
    onArchive: vi.fn(),
    onDelete: vi.fn(),
    onMoveNote: vi.fn(),
    onRenameFolder: vi.fn(),
    onRemoveFolder: vi.fn(),
  };
  render(
    <NoteList
      notes={[]}
      folders={[]}
      syncSlot={null}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("NoteList", () => {
  it("shows the empty-state prompt and starts a note on Enter", () => {
    stubMatchMedia(true);
    const { onNew } = renderList();

    expect(screen.getByText(/No notes yet/)).toBeTruthy();

    // The empty state's keyboard shortcut: Enter (no modifier, focus not in a
    // field) starts the first note.
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("shows the loading hint instead of the empty prompt while loading", () => {
    stubMatchMedia(true);
    const { onNew } = renderList({ loading: true });

    expect(screen.getByText("Loading notes…")).toBeTruthy();
    expect(screen.queryByText(/No notes yet/)).toBeNull();

    // Enter is suppressed while loading — there's no empty state to act on yet.
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onNew).not.toHaveBeenCalled();
  });

  it("renders a flat list of note titles and opens one on click", () => {
    stubMatchMedia(true);
    const { onOpen } = renderList({
      notes: [
        note({ id: "a", title: "Apples" }),
        note({ id: "b", title: "Bread" }),
      ],
    });

    expect(screen.getByText("Apples")).toBeTruthy();
    expect(screen.getByText("Bread")).toBeTruthy();
    // No folders, so the "No folder" section label is absent.
    expect(screen.queryByText("No folder")).toBeNull();

    fireEvent.click(screen.getByText("Apples"));
    expect(onOpen).toHaveBeenCalledWith("a");
  });

  it("groups notes under a folder header and files a new note into it", () => {
    stubMatchMedia(true);
    const { onNew } = renderList({
      folders: [folder({ id: "f1", name: "Work" })],
      notes: [
        note({ id: "a", title: "Filed", folderId: "f1" }),
        note({ id: "b", title: "Loose" }),
      ],
    });

    // The folder header carries its name and note count; the ungrouped zone's
    // "No folder" label only appears once a folder exists.
    expect(screen.getByText("Work")).toBeTruthy();
    expect(screen.getByText("No folder")).toBeTruthy();
    expect(screen.getByText("Filed")).toBeTruthy();
    expect(screen.getByText("Loose")).toBeTruthy();

    // The per-folder "New note" button files straight into that folder. (The
    // bottom floating action button shares the label but renders last, so the
    // folder button is the first match.)
    fireEvent.click(screen.getAllByRole("button", { name: "New note" })[0]!);
    expect(onNew).toHaveBeenCalledWith("f1");
  });

  it("renames a folder in place from the desktop right-click menu", () => {
    stubMatchMedia(true);
    const { onRenameFolder } = renderList({
      folders: [folder({ id: "f1", name: "Work" })],
      notes: [note({ id: "a", title: "Filed", folderId: "f1" })],
    });

    // Right-click the folder header to summon the rename/delete menu.
    fireEvent.contextMenu(screen.getByText("Work"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename folder" }));

    // The header swaps for the inline editor; commit a new name on Enter.
    const input = screen.getByLabelText("Folder name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Personal" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRenameFolder).toHaveBeenCalledWith("f1", "Personal");
  });
});
