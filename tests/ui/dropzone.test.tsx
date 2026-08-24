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
import { DEFAULT_EDITOR_SETTINGS } from "../../src/theme/themes.ts";
import { DropzoneDeletedToast } from "../../src/ui/DropzoneDeletedToast.tsx";
import { Editor } from "../../src/ui/NoteEditor.tsx";
import { resetEditorPositions } from "../../src/ui/editor-position.ts";
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
  vi.unstubAllGlobals();
  resetEditorPositions();
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

  function renderMenu(dropzone: Note[], notes: Note[] = []) {
    const onSelectNote = vi.fn();
    render(
      <ModalBusContext.Provider
        value={{ dispatch: vi.fn(), active: null, close: vi.fn() }}
      >
        <NavContext.Provider value={nav}>
          <SideMenu
            notes={notes}
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

  it("keeps a dropzone row's box identical to an ordinary note row's", () => {
    // Every row in the drawer renders through the same wrapper, archivable or
    // not: the archive backdrop is drawn even where nothing can uncover it, so
    // one row shape is the only shape there is. A row that diverged here would
    // be exactly the kind that renders everywhere except the one place it is
    // needed.
    const dz = createDropzoneNote(new Date(2025, 2, 4, 17, 9).getTime());
    const ordinary: Note = {
      id: "n1",
      title: "Groceries",
      body: "Milk",
      createdAt: 1,
      updatedAt: 1,
    };
    renderMenu([dz], [ordinary]);
    // Up from the row button to the swipe wrapper, and count what it draws.
    const parts = (label: string) => {
      const row = screen.getByText(label).closest('[role="menuitem"]');
      return row?.parentElement?.parentElement?.children.length;
    };
    expect(parts("2025-03-04 17:09")).toBe(parts("Groceries"));
    expect(parts("Groceries")).toBeGreaterThan(0);
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

// The editor a dropzone note opens in. Markdown rendering off, so the body is a
// plain textarea the test can ask about focus directly.
describe("a dropzone note's editor", () => {
  const nav: NavContextValue = {
    open: false,
    toggle: vi.fn(),
    close: vi.fn(),
    setDragging: vi.fn(),
    position: { side: "right", y: 0.5 },
    setPosition: vi.fn(),
    showMenuButton: true,
    setShowMenuButton: vi.fn(),
    showButton: true,
    pinned: false,
    sidebarCollapsed: false,
    toggleSidebar: vi.fn(),
  };
  const PLAIN = { ...DEFAULT_EDITOR_SETTINGS, renderMarkdown: false };

  function renderEditor(note: Note, onDropzoneDone?: () => void) {
    render(
      <NavContext.Provider value={nav}>
        <Editor
          note={note}
          editor={PLAIN}
          onBack={vi.fn()}
          onChange={vi.fn()}
          onTitleChange={vi.fn()}
          onTitleSettle={vi.fn()}
          onToggleFavorite={vi.fn()}
          onToggleLock={vi.fn()}
          onDropzoneDone={onDropzoneDone}
          canAttach={false}
          onAttach={vi.fn()}
        />
      </NavContext.Provider>,
    );
  }

  it("opens with the caret already in the body, ready to paste", () => {
    // The note is born named, so the title field never takes the mount focus
    // the way a blank new note's does — without the body taking it instead the
    // editor would open with nothing focused at all.
    renderEditor(createDropzoneNote(Date.now()));
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
    expect((document.activeElement as HTMLTextAreaElement).value).toBe("");
  });

  it("does not steal the focus of a dropzone note that already has text", () => {
    renderEditor({ ...createDropzoneNote(Date.now()), body: "already here" });
    expect(document.activeElement?.tagName).not.toBe("TEXTAREA");
  });

  it("ticks off through the floating checkmark", () => {
    const done = vi.fn();
    renderEditor(createDropzoneNote(Date.now()), done);
    fireEvent.click(screen.getByLabelText("Done — delete this note"));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("grows no checkmark for an ordinary note", () => {
    renderEditor({
      id: "n1",
      title: "Groceries",
      body: "Milk",
      createdAt: 0,
      updatedAt: 0,
    });
    expect(screen.queryByLabelText("Done — delete this note")).toBeNull();
  });
});

// The confirmation that follows the checkmark. The editor is gone by the time
// it shows, so `App` hosts it and feeds it a tick-off counter; the toast owns
// its own clock.
describe("the deletion toast", () => {
  const nav: NavContextValue = {
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
    sidebarCollapsed: false,
    toggleSidebar: vi.fn(),
  };

  function renderToast(seq: number, onUndo = vi.fn()) {
    const view = render(
      <NavContext.Provider value={nav}>
        <DropzoneDeletedToast seq={seq} onUndo={onUndo} />
      </NavContext.Provider>,
    );
    const rerender = (next: number) =>
      view.rerender(
        <NavContext.Provider value={nav}>
          <DropzoneDeletedToast seq={next} onUndo={onUndo} />
        </NavContext.Provider>,
      );
    return { onUndo, rerender };
  }

  it("stays hidden before any tick-off", () => {
    renderToast(0);
    expect(screen.queryByText("Dropzone note deleted")).toBeNull();
  });

  it("shows on a tick-off and expires on its own", () => {
    const { rerender } = renderToast(0);
    rerender(1);
    expect(screen.getByText("Dropzone note deleted")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.queryByText("Dropzone note deleted")).toBeNull();
  });

  it("undoes the deletion through its button, once", () => {
    const { onUndo, rerender } = renderToast(0);
    rerender(1);
    fireEvent.click(screen.getByText("Undo"));
    expect(onUndo).toHaveBeenCalledTimes(1);
    // The press consumed the toast — there is nothing left to press twice.
    expect(screen.queryByText("Dropzone note deleted")).toBeNull();
  });

  it("restarts its clock when a second note is ticked off", () => {
    const { rerender } = renderToast(0);
    rerender(1);
    act(() => void vi.advanceTimersByTime(4000));
    rerender(2);
    act(() => void vi.advanceTimersByTime(4000));
    // 8 seconds after the first press, the second still holds it open.
    expect(screen.getByText("Dropzone note deleted")).toBeTruthy();
  });
});
