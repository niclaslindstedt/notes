// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
});
