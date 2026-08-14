// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/preact";

import type { Folder, Note } from "../../src/domain/note.ts";
import { replaceAppearance } from "../../src/theme/useTheme.ts";
import { SideMenu } from "../../src/ui/SideMenu.tsx";
import { ModalBusContext } from "../../src/ui/modal-bus.ts";
import { NavContext, type NavContextValue } from "../../src/ui/nav-context.ts";

afterEach(() => {
  cleanup();
  // The appearance store is module-level state shared across the suite, so put
  // the folder-structure preference back on its default after every case.
  replaceAppearance({});
});

const WORK: Folder = { id: "f1", name: "Work", createdAt: 1 };

function note(id: string, title: string, over: Partial<Note> = {}): Note {
  return { id, title, body: "", createdAt: 1, updatedAt: 1, ...over };
}

function renderMenu(notes: Note[]) {
  const value: NavContextValue = {
    open: false,
    toggle: vi.fn(),
    close: vi.fn(),
    setDragging: vi.fn(),
    position: { side: "left", y: 0.5 },
    setPosition: vi.fn(),
    showMenuButton: true,
    setShowMenuButton: vi.fn(),
    showButton: false,
    // Docked, so the section list renders without an open/close beat.
    pinned: true,
    sidebarCollapsed: false,
    toggleSidebar: vi.fn(),
  };
  return render(
    <ModalBusContext.Provider
      value={{ dispatch: vi.fn(), active: null, close: vi.fn() }}
    >
      <NavContext.Provider value={value}>
        <SideMenu
          notes={notes}
          activeNoteId={null}
          onSelectNote={vi.fn()}
          onShowAll={vi.fn()}
          showAllActive={false}
          onAddNote={vi.fn()}
          onRemoveNote={vi.fn()}
          onArchiveNote={vi.fn()}
          archivedCount={0}
          onOpenArchive={vi.fn()}
          archiveActive={false}
          onUndo={vi.fn()}
          onRedo={vi.fn()}
          canUndo={false}
          canRedo={false}
          folders={[WORK]}
          onMoveNote={vi.fn()}
          onMoveNoteToNamespace={vi.fn()}
          onMoveFolderToNamespace={vi.fn()}
          onCreateFolder={vi.fn(() => "new")}
          onRenameFolder={vi.fn()}
          onRemoveFolder={vi.fn()}
          namespaces={[{ slug: "default", name: "Default" }]}
          activeNamespace="default"
          onSwitchNamespace={vi.fn()}
        />
      </NavContext.Provider>
    </ModalBusContext.Provider>,
  );
}

describe("SideMenu — the Favorites section", () => {
  it("stays out of the drawer entirely while nothing is starred", () => {
    renderMenu([note("a", "Plain note")]);
    expect(screen.queryByText("Favorites")).toBeNull();
  });

  it("lists a starred note above the note list", () => {
    renderMenu([note("a", "Starred note", { favorite: true })]);
    const headings = screen
      .getAllByText(/^(Favorites|Notes)$/)
      .map((el) => el.textContent);
    expect(headings).toEqual(["Favorites", "Notes"]);
    // Once in Favorites and once in the ordinary list below it — starring is a
    // shortcut, not a move.
    expect(screen.getAllByText("Starred note")).toHaveLength(2);
  });

  it("flattens the folder structure away by default", () => {
    renderMenu([
      note("a", "Filed favorite", { favorite: true, folderId: WORK.id }),
    ]);
    // The favorite shows without expanding its folder, and "Work" appears only
    // as the collapsed folder row in the Notes section below.
    expect(screen.getByText("Filed favorite")).toBeTruthy();
    expect(screen.getAllByText("Work")).toHaveLength(1);
  });

  it("reproduces the folder structure when the setting is on", () => {
    replaceAppearance({ favoritesShowFolders: true });
    renderMenu([
      note("a", "Filed favorite", { favorite: true, folderId: WORK.id }),
    ]);
    // A second "Work" caption now heads the run inside Favorites.
    expect(screen.getAllByText("Work")).toHaveLength(2);
    expect(screen.getByText("Filed favorite")).toBeTruthy();
  });

  it("leaves an archived favorite out of the section", () => {
    renderMenu([note("a", "Filed away", { favorite: true, archived: true })]);
    expect(screen.queryByText("Favorites")).toBeNull();
  });
});
