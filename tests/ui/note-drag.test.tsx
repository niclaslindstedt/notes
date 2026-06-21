// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NoteDragItem, NoteDragProvider } from "../../src/ui/note-drag.tsx";
import {
  NOTE_DROP_ATTR,
  NOTE_DROP_ROOT,
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

function setup(onMove: (id: string, folderId: string | null) => void) {
  const utils = render(
    <NoteDragProvider onMove={onMove}>
      <NoteDragItem noteId="n1" title="My note" enabled>
        <button data-testid="note">My note</button>
      </NoteDragItem>
      <div data-testid="folder" {...{ [NOTE_DROP_ATTR]: "f1" }}>
        Folder
      </div>
      <div data-testid="root" {...{ [NOTE_DROP_ATTR]: NOTE_DROP_ROOT }}>
        Ungrouped
      </div>
    </NoteDragProvider>,
  );
  // The wrapper carrying the pointer handlers is the note button's parent.
  const wrapper = utils.getByTestId("note").parentElement!;
  return { ...utils, wrapper };
}

const touch = { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 10 };

describe("note long-press drag", () => {
  it("files the note into the folder held under the finger on release", () => {
    const onMove = vi.fn();
    const { wrapper, getByTestId } = setup(onMove);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(
      getByTestId("folder"),
    );

    fireEvent.pointerDown(wrapper, touch);
    // Hold still past the long-press threshold → the note is picked up.
    act(() => void vi.advanceTimersByTime(400));
    fireEvent.pointerMove(wrapper, { ...touch, clientX: 50, clientY: 200 });
    fireEvent.pointerUp(wrapper, { pointerId: 1 });

    expect(onMove).toHaveBeenCalledExactlyOnceWith("n1", "f1");
  });

  it("moves the note out of any folder when dropped on the ungrouped zone", () => {
    const onMove = vi.fn();
    const { wrapper, getByTestId } = setup(onMove);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(getByTestId("root"));

    fireEvent.pointerDown(wrapper, touch);
    act(() => void vi.advanceTimersByTime(400));
    fireEvent.pointerMove(wrapper, { ...touch, clientX: 50, clientY: 300 });
    fireEvent.pointerUp(wrapper, { pointerId: 1 });

    expect(onMove).toHaveBeenCalledExactlyOnceWith("n1", null);
  });

  it("does not pick the note up if the finger moves before the press latches", () => {
    const onMove = vi.fn();
    const { wrapper, getByTestId } = setup(onMove);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(
      getByTestId("folder"),
    );

    fireEvent.pointerDown(wrapper, touch);
    // Travel past the slop before the timer fires → it's a scroll/swipe.
    fireEvent.pointerMove(wrapper, { ...touch, clientX: 10, clientY: 60 });
    act(() => void vi.advanceTimersByTime(400));
    fireEvent.pointerUp(wrapper, { pointerId: 1 });

    expect(onMove).not.toHaveBeenCalled();
  });

  it("ignores a mouse pointer (the desktop HTML5 path owns that)", () => {
    const onMove = vi.fn();
    const { wrapper, getByTestId } = setup(onMove);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(
      getByTestId("folder"),
    );

    fireEvent.pointerDown(wrapper, { ...touch, pointerType: "mouse" });
    act(() => void vi.advanceTimersByTime(400));
    fireEvent.pointerUp(wrapper, { pointerId: 1 });

    expect(onMove).not.toHaveBeenCalled();
  });
});
