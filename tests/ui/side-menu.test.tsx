// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";

import type { Folder, Note } from "../../src/domain/note.ts";
import { SideMenu } from "../../src/ui/SideMenu.tsx";
import { ModalBusContext } from "../../src/ui/modal-bus.ts";
import { NavContext, type NavContextValue } from "../../src/ui/nav-context.ts";

afterEach(cleanup);

const FOLDER: Folder = { id: "f1", name: "Work", createdAt: 1 };

function note(id: string, title: string, folderId?: string): Note {
  return {
    id,
    title,
    body: "",
    createdAt: 1,
    updatedAt: 1,
    ...(folderId ? { folderId } : {}),
  };
}

// `useT` and `useAppearance` fall back to defaults on their own; the drawer
// needs the modal bus and the nav state it reads its open/pinned flags from.
function renderMenu(
  nav: Partial<NavContextValue>,
  props: { activeNoteId?: string | null; notes?: Note[] } = {},
) {
  const value: NavContextValue = {
    open: false,
    toggle: vi.fn(),
    close: vi.fn(),
    setDragging: vi.fn(),
    position: { side: "left", y: 0.5 },
    setPosition: vi.fn(),
    showMenuButton: true,
    setShowMenuButton: vi.fn(),
    showButton: true,
    pinned: false,
    ...nav,
  };
  return render(
    <ModalBusContext.Provider
      value={{ dispatch: vi.fn(), active: null, close: vi.fn() }}
    >
      <NavContext.Provider value={value}>
        <SideMenu
          notes={props.notes ?? [note("a", "Filed note", FOLDER.id)]}
          activeNoteId={
            props.activeNoteId === undefined ? "a" : props.activeNoteId
          }
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
          folders={[FOLDER]}
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

describe("SideMenu — revealing the active note", () => {
  it("opens the folder the active note is filed in as the drawer slides open", () => {
    // Closed, the drawer renders nothing but the floating button — opening it
    // is what has to land with the folder already expanded.
    renderMenu({ open: false });
    expect(screen.queryByText("Filed note")).toBeNull();
    cleanup();

    renderMenu({ open: true });
    expect(screen.getByText("Filed note")).toBeTruthy();
  });

  it("expands the active note's folder on the docked sidebar too", () => {
    renderMenu({ pinned: true });
    expect(screen.getByText("Filed note")).toBeTruthy();
  });

  it("leaves folders collapsed when the active note isn't in one", () => {
    renderMenu(
      { open: true },
      { notes: [note("a", "Loose note"), note("b", "Filed note", FOLDER.id)] },
    );
    // The loose note is the active one, so the folder stays shut and its note
    // is not listed.
    expect(screen.getByText("Loose note")).toBeTruthy();
    expect(screen.queryByText("Filed note")).toBeNull();
  });

  it("respects collapsing the revealed folder by hand", () => {
    renderMenu({ open: true });
    expect(screen.getByText("Filed note")).toBeTruthy();
    // Pressing the folder row shuts it again; nothing re-opens it while the
    // active note stays put.
    fireEvent.click(screen.getByText("Work"));
    expect(screen.queryByText("Filed note")).toBeNull();
  });

  it("ignores a folder id no folder in the registry answers to", () => {
    renderMenu({ open: true }, { notes: [note("a", "Orphan", "gone")] });
    // A stale link renders the note ungrouped, so it shows without any folder
    // being expanded.
    expect(screen.getByText("Orphan")).toBeTruthy();
  });
});
