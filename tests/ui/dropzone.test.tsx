// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDropzoneNote, type Note } from "../../src/domain/note.ts";
import { NoteList } from "../../src/ui/note-list/NoteList.tsx";
import { SideMenu } from "../../src/ui/SideMenu.tsx";
import { ModalBusContext } from "../../src/ui/modal-bus.ts";
import { NavContext, type NavContextValue } from "../../src/ui/nav-context.ts";

// The two surfaces the dropzone shows up on: the overview's "+" (whose hold
// makes one) and the side menu (which lists them in their own section).

beforeEach(() => {
  vi.useFakeTimers();
  stubMatchMedia(false);
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

// Both surfaces read `useMediaQuery` to pick the desktop vs touch affordances;
// jsdom has no `matchMedia`, so stub it as a touch device.
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

const press = { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 10 };

/** Hold the button down for `ms`, then let go — the gesture, end to end. */
function hold(button: HTMLElement, ms = 600) {
  fireEvent.pointerDown(button, press);
  act(() => void vi.advanceTimersByTime(ms));
  fireEvent.pointerUp(button, { pointerId: 1 });
  // A touchscreen still delivers the click that trails the hold.
  fireEvent.click(button);
}

describe("the overview's new-note button", () => {
  function renderList(props: Partial<Parameters<typeof NoteList>[0]> = {}) {
    const handlers = {
      onOpen: vi.fn(),
      onNew: vi.fn(),
      onNewDropzone: vi.fn(),
      onArchive: vi.fn(),
      onDelete: vi.fn(),
      onMoveNote: vi.fn(),
      onRenameFolder: vi.fn(),
      onRemoveFolder: vi.fn(),
    };
    render(<NoteList notes={[]} folders={[]} {...handlers} {...props} />);
    return { ...handlers, button: screen.getByLabelText("New note") };
  }

  it("makes an ordinary note on a plain press", () => {
    const { button, onNew, onNewDropzone } = renderList();
    fireEvent.pointerDown(button, press);
    fireEvent.pointerUp(button, { pointerId: 1 });
    fireEvent.click(button);
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onNewDropzone).not.toHaveBeenCalled();
  });

  it("makes a dropzone note when held, and swallows the trailing click", () => {
    const { button, onNew, onNewDropzone } = renderList();
    hold(button);
    expect(onNewDropzone).toHaveBeenCalledTimes(1);
    expect(onNew).not.toHaveBeenCalled();
  });

  it("abandons the hold when the finger moves off — that's a scroll", () => {
    const { button, onNew, onNewDropzone } = renderList();
    fireEvent.pointerDown(button, press);
    fireEvent.pointerMove(button, { ...press, clientY: 200 });
    act(() => void vi.advanceTimersByTime(600));
    fireEvent.pointerUp(button, { pointerId: 1 });
    fireEvent.click(button);
    expect(onNewDropzone).not.toHaveBeenCalled();
    // The press it turned out to be still counts as an ordinary one.
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("stays a plain new-note button where nothing else can read the note", () => {
    const { button, onNew } = renderList({ onNewDropzone: undefined });
    hold(button);
    expect(onNew).toHaveBeenCalledTimes(1);
  });
});

describe("the side menu's Dropzone section", () => {
  const nav: NavContextValue = {
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

  function renderMenu(dropzone: Note[]) {
    const onSelectNote = vi.fn();
    render(
      <ModalBusContext.Provider
        value={{ dispatch: vi.fn(), active: null, close: vi.fn() }}
      >
        <NavContext.Provider value={nav}>
          <SideMenu
            notes={[]}
            activeNoteId={null}
            onSelectNote={onSelectNote}
            onShowAll={vi.fn()}
            showAllActive={false}
            onAddNote={vi.fn()}
            dropzone={dropzone}
            onAddDropzone={vi.fn()}
            onRemoveNote={vi.fn()}
            onArchiveNote={vi.fn()}
            archivedCount={0}
            onOpenArchive={vi.fn()}
            archiveActive={false}
            onUndo={vi.fn()}
            onRedo={vi.fn()}
            canUndo={false}
            canRedo={false}
            folders={[]}
            onMoveNote={vi.fn()}
            onMoveNoteToNamespace={vi.fn()}
            onMoveFolderToNamespace={vi.fn()}
            onCreateFolder={vi.fn()}
            onRenameFolder={vi.fn()}
            onRemoveFolder={vi.fn()}
            namespaces={[{ slug: "default", name: "Default" }]}
            activeNamespace="default"
            onSwitchNamespace={vi.fn()}
          />
        </NavContext.Provider>
      </ModalBusContext.Provider>,
    );
    return { onSelectNote };
  }

  it("is absent while the dropzone is empty", () => {
    renderMenu([]);
    expect(screen.queryByText("Dropzone")).toBeNull();
  });

  it("lists each note under its timestamp, and opens it on tap", () => {
    const made = createDropzoneNote(new Date(2025, 2, 4, 17, 9).getTime());
    const { onSelectNote } = renderMenu([made]);
    expect(screen.getByText("Dropzone")).toBeTruthy();
    const row = screen.getByText("2025-03-04 17:09");
    fireEvent.click(row);
    expect(onSelectNote).toHaveBeenCalledWith(made.id);
  });
});
