// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownEditor } from "../../src/ui/MarkdownEditor.tsx";
import { resetEditorPositions } from "../../src/ui/editor-position.ts";

const editorProps = {
  wordWrap: true,
  disableSpellcheck: false,
  disableAutocorrect: false,
  maxWidth: "none",
  onTabOut: () => {},
  focusOnMount: false,
} as const;

const BODY = "alpha\nbravo\ncharlie\ndelta";

function renderEditor(extra?: Record<string, unknown>) {
  const onChange = vi.fn();
  const onSelectModeChange = vi.fn();
  const utils = render(
    <MarkdownEditor
      body={BODY}
      onChange={onChange}
      selectMode
      onSelectModeChange={onSelectModeChange}
      {...editorProps}
      {...extra}
    />,
  );
  return { onChange, onSelectModeChange, ...utils };
}

function surface(): HTMLElement {
  return screen.getByRole("textbox");
}

function rows(): HTMLElement[] {
  return [...surface().querySelectorAll<HTMLElement>("[data-line-row]")];
}

/** Which lines are painted as taken — the whole visible answer of the mode. */
function tinted(): number[] {
  return rows()
    .filter((row) => row.classList.contains("line-selected"))
    .map((row) => Number(row.dataset.lineRow));
}

// jsdom lays nothing out and has no hit test, so the editor falls back to
// measuring rows — stand each one on a 20px band of its own so a y coordinate
// means a line, the way it does in a browser.
function layOutRows() {
  for (const [i, row] of rows().entries()) {
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
      top: i * 20,
      bottom: i * 20 + 20,
      left: 0,
      right: 200,
      width: 200,
      height: 20,
      x: 0,
      y: i * 20,
      toJSON: () => ({}),
    } as DOMRect);
  }
}

/** The y at the middle of line `index`'s band. */
function yOf(index: number): number {
  return index * 20 + 10;
}

function press(index: number, pointerType = "mouse") {
  fireEvent.pointerDown(surface().parentElement!, {
    pointerId: 1,
    pointerType,
    clientX: 40,
    clientY: yOf(index),
  });
}

function moveTo(index: number, pointerType = "mouse") {
  fireEvent.pointerMove(surface().parentElement!, {
    pointerId: 1,
    pointerType,
    clientX: 40,
    clientY: yOf(index),
  });
}

function release(index: number, pointerType = "mouse") {
  fireEvent.pointerUp(surface().parentElement!, {
    pointerId: 1,
    pointerType,
    clientX: 40,
    clientY: yOf(index),
  });
}

function beforeInput(inputType: string, data: string | null = null) {
  act(() => {
    surface().dispatchEvent(
      new InputEvent("beforeinput", {
        inputType,
        data,
        cancelable: true,
        bubbles: true,
      }),
    );
  });
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  resetEditorPositions();
});

describe("select mode", () => {
  it("takes the whole line a press lands on", () => {
    renderEditor();
    layOutRows();
    press(2);
    expect(tinted()).toEqual([2]);
  });

  it("walks the run a line at a time as the press drags down", () => {
    renderEditor();
    layOutRows();
    press(1);
    moveTo(2);
    expect(tinted()).toEqual([1, 2]);
    moveTo(3);
    expect(tinted()).toEqual([1, 2, 3]);
    // Dragging back up shrinks it again rather than leaving the high-water mark.
    moveTo(2);
    expect(tinted()).toEqual([1, 2]);
  });

  it("drags upwards from the anchor just as readily", () => {
    renderEditor();
    layOutRows();
    press(3);
    moveTo(1);
    expect(tinted()).toEqual([1, 2, 3]);
  });

  it("tints the line number along with the text", () => {
    renderEditor({ lineNumbers: true });
    layOutRows();
    press(1);
    const number = screen.getByRole("button", { name: "Select line 2" });
    expect(number.className).toContain("line-selected");
    expect(number.closest("[data-line-row]")?.className).toContain(
      "line-selected",
    );
  });

  it("waits for the hold before a finger starts sweeping", () => {
    vi.useFakeTimers();
    try {
      renderEditor();
      layOutRows();
      press(1, "touch");
      // Straight into a scroll: the line pressed stays taken, but the drag
      // never opens, so the note is free to scroll under the finger.
      moveTo(3, "touch");
      expect(tinted()).toEqual([1]);

      press(1, "touch");
      act(() => {
        vi.advanceTimersByTime(400);
      });
      moveTo(3, "touch");
      expect(tinted()).toEqual([1, 2, 3]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hands the run over as an ordinary selection on Escape", () => {
    const { onSelectModeChange } = renderEditor();
    layOutRows();
    press(1);
    moveTo(2);
    release(2);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onSelectModeChange).toHaveBeenCalledWith(false);

    const sel = window.getSelection()!;
    expect(sel.isCollapsed).toBe(false);
    expect(sel.toString()).toContain("bravo");
    expect(sel.toString()).toContain("charlie");
  });

  it("leaves the mode when the run itself is pressed", () => {
    const { onSelectModeChange } = renderEditor();
    layOutRows();
    press(1);
    release(1);
    expect(onSelectModeChange).not.toHaveBeenCalled();

    press(1);
    release(1);
    expect(onSelectModeChange).toHaveBeenCalledWith(false);
  });

  it("re-anchors instead of leaving when a different line is pressed", () => {
    const { onSelectModeChange } = renderEditor();
    layOutRows();
    press(1);
    release(1);
    press(3);
    release(3);
    expect(onSelectModeChange).not.toHaveBeenCalled();
    expect(tinted()).toEqual([3]);
  });

  it("types over the run and leaves the mode", () => {
    const { onChange, onSelectModeChange } = renderEditor();
    layOutRows();
    press(1);
    moveTo(2);
    beforeInput("insertText", "X");
    expect(onChange).toHaveBeenCalledWith("alpha\nX\ndelta");
    expect(onSelectModeChange).toHaveBeenCalledWith(false);
  });

  it("deletes the run's lines outright, leaving no blanks", () => {
    const { onChange, onSelectModeChange } = renderEditor();
    layOutRows();
    press(1);
    moveTo(2);
    fireEvent.keyDown(document, { key: "Backspace" });
    expect(onChange).toHaveBeenCalledWith("alpha\ndelta");
    expect(onSelectModeChange).toHaveBeenCalledWith(false);
  });

  it("walks the run with the arrow keys, extending on Shift", () => {
    renderEditor();
    layOutRows();
    press(1);
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(tinted()).toEqual([2]);
    fireEvent.keyDown(document, { key: "ArrowDown", shiftKey: true });
    expect(tinted()).toEqual([2, 3]);
  });

  it("takes the whole note on Ctrl+A", () => {
    renderEditor();
    layOutRows();
    press(1);
    fireEvent.keyDown(document, { key: "a", ctrlKey: true });
    expect(tinted()).toEqual([0, 1, 2, 3]);
  });

  it("reports the run to the host so the header can act on it", () => {
    const onSelectionChange = vi.fn();
    renderEditor({ onSelectionChange });
    layOutRows();
    press(2);
    expect(onSelectionChange).toHaveBeenCalledWith(true);
  });

  it("refuses to rewrite a locked note, but still lets the run be taken", () => {
    const { onChange } = renderEditor({ locked: true });
    layOutRows();
    press(1);
    expect(tinted()).toEqual([1]);
    fireEvent.keyDown(document, { key: "Backspace" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("paints nothing while the mode is off", () => {
    renderEditor({ selectMode: false });
    layOutRows();
    press(2);
    expect(tinted()).toEqual([]);
  });
});
