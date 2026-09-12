// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";

import type { Folder, Note } from "../../src/domain/note.ts";
import { replaceAppearance } from "../../src/theme/useTheme.ts";
import { SideMenu, type SideMenuProps } from "../../src/ui/SideMenu.tsx";
import { ModalBusContext } from "../../src/ui/modal-bus.ts";
import { NavContext, type NavContextValue } from "../../src/ui/nav-context.ts";

afterEach(() => {
  cleanup();
  // The appearance store is module-level state shared across the suite, so put
  // the folder-structure preference back on its default after every case.
  replaceAppearance({});
  // `vi.stubGlobal` survives `restoreAllMocks`, so a desktop case's
  // `matchMedia` would otherwise leak into the next (touch) one.
  vi.unstubAllGlobals();
});

// The rows pick the desktop right-click menu over the touch swipe strip off
// `useMediaQuery("(hover: hover) and (pointer: fine)")`; jsdom has no
// `matchMedia`, so stub it (unstubbed → touch).
function stubDesktop() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
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

const WORK: Folder = { id: "f1", name: "Work", createdAt: 1 };

function note(id: string, title: string, over: Partial<Note> = {}): Note {
  return { id, title, body: "", createdAt: 1, updatedAt: 1, ...over };
}

function renderMenu(notes: Note[], extra: Partial<SideMenuProps> = {}) {
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
          dropzone={[]}
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
          {...extra}
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

  it("offers unstarring on a starred row's right-click menu, and only there", () => {
    stubDesktop();
    const onUnfavoriteNote = vi.fn();
    renderMenu(
      [note("a", "Starred note", { favorite: true }), note("b", "Plain note")],
      { onUnfavoriteNote },
    );
    // The favorite is listed twice (Favorites + Notes); either row offers it.
    fireEvent.contextMenu(screen.getAllByText("Starred note")[0]!);
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Remove from favorites" }),
    );
    expect(onUnfavoriteNote).toHaveBeenCalledWith("a");

    fireEvent.contextMenu(screen.getByText("Plain note"));
    expect(
      screen.queryByRole("menuitem", { name: "Remove from favorites" }),
    ).toBeNull();
  });

  it("leaves an archived favorite out of the section", () => {
    renderMenu([note("a", "Filed away", { favorite: true, archived: true })]);
    expect(screen.queryByText("Favorites")).toBeNull();
  });
});
