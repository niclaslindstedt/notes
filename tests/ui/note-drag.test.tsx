// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReportDragActivityContext } from "../../src/ui/drag-activity.ts";
import { NoteDragItem, NoteDragProvider } from "../../src/ui/note-drag.tsx";
import {
  NOTE_DROP_ARCHIVE,
  NOTE_DROP_ATTR,
  NOTE_DROP_ROOT,
  noteDropNamespaceKey,
} from "../../src/ui/note-drag-context.ts";

// jsdom implements neither pointer capture nor hit-testing; stub both so the
// long-press gesture can run. `elementFromPoint` is re-pointed per test.
beforeEach(() => {
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  // jsdom doesn't implement hit-testing — define it so each test can spy it.
  if (!document.elementFromPoint) {
    document.elementFromPoint = () => null;
  }
  vi.useFakeTimers();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

function setup(onDrop: (id: string, key: string) => void) {
  const utils = render(
    <NoteDragProvider onDrop={onDrop}>
      <NoteDragItem noteId="n1" title="My note" enabled>
        <button data-testid="note">My note</button>
      </NoteDragItem>
      <div data-testid="folder" {...{ [NOTE_DROP_ATTR]: "f1" }}>
        Folder
      </div>
      <div data-testid="root" {...{ [NOTE_DROP_ATTR]: NOTE_DROP_ROOT }}>
        Ungrouped
      </div>
      <div
        data-testid="ns"
        {...{ [NOTE_DROP_ATTR]: noteDropNamespaceKey("work") }}
      >
        Work
      </div>
      <div data-testid="archive" {...{ [NOTE_DROP_ATTR]: NOTE_DROP_ARCHIVE }}>
        Archive
      </div>
    </NoteDragProvider>,
  );
  // The wrapper carrying the pointer handlers is the note button's parent.
  const wrapper = utils.getByTestId("note").parentElement!;
  return { ...utils, wrapper };
}

const touch = { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 10 };

// Press-and-hold, then release over `target` — the gesture a touch user makes.
function dragOnto(wrapper: HTMLElement, target: HTMLElement) {
  vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
  fireEvent.pointerDown(wrapper, touch);
  act(() => void vi.advanceTimersByTime(400));
  fireEvent.pointerMove(wrapper, { ...touch, clientX: 50, clientY: 200 });
  fireEvent.pointerUp(wrapper, { pointerId: 1 });
}

describe("note long-press drag", () => {
  it("reports the folder key when dropped on a folder", () => {
    const onDrop = vi.fn();
    const { wrapper, getByTestId } = setup(onDrop);
    dragOnto(wrapper, getByTestId("folder"));
    expect(onDrop).toHaveBeenCalledExactlyOnceWith("n1", "f1");
  });

  it("reports the root key when dropped on the ungrouped zone", () => {
    const onDrop = vi.fn();
    const { wrapper, getByTestId } = setup(onDrop);
    dragOnto(wrapper, getByTestId("root"));
    expect(onDrop).toHaveBeenCalledExactlyOnceWith("n1", NOTE_DROP_ROOT);
  });

  it("reports the namespace key when dropped on a namespace row", () => {
    const onDrop = vi.fn();
    const { wrapper, getByTestId } = setup(onDrop);
    dragOnto(wrapper, getByTestId("ns"));
    expect(onDrop).toHaveBeenCalledExactlyOnceWith("n1", "ns:work");
  });

  it("reports the archive key when dropped on the Archive row", () => {
    const onDrop = vi.fn();
    const { wrapper, getByTestId } = setup(onDrop);
    dragOnto(wrapper, getByTestId("archive"));
    expect(onDrop).toHaveBeenCalledExactlyOnceWith("n1", NOTE_DROP_ARCHIVE);
  });

  it("positions the drag chip at the pickup point before the finger moves", () => {
    const onDrop = vi.fn();
    const { wrapper, container, getByTestId } = setup(onDrop);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(getByTestId("root"));

    fireEvent.pointerDown(wrapper, touch);
    // Latch the long-press; the chip mounts here, before any pointermove.
    act(() => void vi.advanceTimersByTime(400));

    const chip = container.querySelector<HTMLElement>("[aria-hidden]")!;
    // It must be placed at the fingertip immediately — not left at the
    // top-0/left-0 default until the first move snaps it into place.
    expect(chip.style.transform).toBe(
      "translate(10px, 10px) translate(-50%, -150%)",
    );
  });

  it("does not pick the note up if the finger moves before the press latches", () => {
    const onDrop = vi.fn();
    const { wrapper, getByTestId } = setup(onDrop);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(
      getByTestId("folder"),
    );

    fireEvent.pointerDown(wrapper, touch);
    // Travel past the slop before the timer fires → it's a scroll/swipe.
    fireEvent.pointerMove(wrapper, { ...touch, clientX: 10, clientY: 60 });
    act(() => void vi.advanceTimersByTime(400));
    fireEvent.pointerUp(wrapper, { pointerId: 1 });

    expect(onDrop).not.toHaveBeenCalled();
  });

  it("ignores a mouse pointer (the desktop HTML5 path owns that)", () => {
    const onDrop = vi.fn();
    const { wrapper, getByTestId } = setup(onDrop);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(
      getByTestId("folder"),
    );

    fireEvent.pointerDown(wrapper, { ...touch, pointerType: "mouse" });
    act(() => void vi.advanceTimersByTime(400));
    fireEvent.pointerUp(wrapper, { pointerId: 1 });

    expect(onDrop).not.toHaveBeenCalled();
  });

  // The move/up handlers live on `window`, not the row, so a release that
  // lands off the dragged row still files the note. Pre-fix they sat on the row
  // and leaned on pointer capture; a pen/touch point that drifted off it (or a
  // browser that refused the capture) never delivered the pointerup and the
  // lifted note froze. The release here fires on `document.body`, which is not
  // inside the row wrapper — an element-bound handler would never see it.
  it("commits the drop when the release lands off the dragged row", () => {
    const onDrop = vi.fn();
    const { wrapper, getByTestId } = setup(onDrop);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(
      getByTestId("folder"),
    );

    fireEvent.pointerDown(wrapper, touch);
    act(() => void vi.advanceTimersByTime(400));
    fireEvent.pointerMove(window, { ...touch, clientX: 50, clientY: 200 });
    fireEvent.pointerUp(document.body, { pointerId: 1 });

    expect(onDrop).toHaveBeenCalledExactlyOnceWith("n1", "f1");
  });

  // A browser-initiated pointercancel (the UA seized the pointer) aborts the
  // drag without committing the half-finished move a deliberate release would.
  it("aborts without filing when the browser cancels the pointer", () => {
    const onDrop = vi.fn();
    const { wrapper, getByTestId } = setup(onDrop);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(
      getByTestId("folder"),
    );

    fireEvent.pointerDown(wrapper, touch);
    act(() => void vi.advanceTimersByTime(400));
    fireEvent.pointerMove(window, { ...touch, clientX: 50, clientY: 200 });
    fireEvent.pointerCancel(window, { pointerId: 1 });

    expect(onDrop).not.toHaveBeenCalled();
  });

  // A background save can collide with another device mid-drag, raising the
  // conflict modal over the list. The lifted note must be torn down — otherwise
  // its floating chip stays frozen in mid-air and its captured pointer keeps
  // swallowing input meant for the modal. The app signals this via `aborted`.
  it("tears the drag down when the app aborts mid-drag (a sync conflict)", () => {
    const onDrop = vi.fn();
    function Tree({ aborted }: { aborted: boolean }) {
      return (
        <NoteDragProvider onDrop={onDrop} aborted={aborted}>
          <NoteDragItem noteId="n1" title="My note" enabled>
            <button data-testid="note">My note</button>
          </NoteDragItem>
          <div data-testid="folder" {...{ [NOTE_DROP_ATTR]: "f1" }}>
            Folder
          </div>
        </NoteDragProvider>
      );
    }
    const { getByTestId, container, rerender } = render(
      <Tree aborted={false} />,
    );
    const wrapper = getByTestId("note").parentElement!;
    vi.spyOn(document, "elementFromPoint").mockReturnValue(
      getByTestId("folder"),
    );

    fireEvent.pointerDown(wrapper, touch);
    act(() => void vi.advanceTimersByTime(400));
    // The note is picked up — the floating chip is mounted.
    expect(container.querySelector("[aria-hidden]")).not.toBeNull();

    // A sync conflict surfaces: the app raises `aborted`.
    act(() => rerender(<Tree aborted={true} />));

    // The chip is gone, and a trailing release commits no move.
    expect(container.querySelector("[aria-hidden]")).toBeNull();
    fireEvent.pointerUp(wrapper, { pointerId: 1 });
    expect(onDrop).not.toHaveBeenCalled();
  });

  // While a note is held the drag reports itself so the document-level
  // pull-to-refresh stands down — dragging downward to a lower folder / the
  // archive would otherwise arm a refresh at the same time.
  it("reports drag activity while a note is held, and clears it on drop", () => {
    const report = vi.fn();
    const { getByTestId } = render(
      <ReportDragActivityContext.Provider value={report}>
        <NoteDragProvider onDrop={() => {}}>
          <NoteDragItem noteId="n1" title="My note" enabled>
            <button data-testid="note">My note</button>
          </NoteDragItem>
          <div data-testid="root" {...{ [NOTE_DROP_ATTR]: NOTE_DROP_ROOT }}>
            Ungrouped
          </div>
        </NoteDragProvider>
      </ReportDragActivityContext.Provider>,
    );
    const wrapper = getByTestId("note").parentElement!;
    vi.spyOn(document, "elementFromPoint").mockReturnValue(getByTestId("root"));

    fireEvent.pointerDown(wrapper, touch);
    act(() => void vi.advanceTimersByTime(400));
    expect(report).toHaveBeenLastCalledWith(true);

    act(() => fireEvent.pointerUp(wrapper, { pointerId: 1 }));
    expect(report).toHaveBeenLastCalledWith(false);
  });
});
