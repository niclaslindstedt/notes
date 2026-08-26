// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "../../src/ui/MarkdownEditor.tsx";
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
  const element = (on: boolean) => (
    <MarkdownEditor
      body={BODY}
      onChange={onChange}
      selectMode={on}
      onSelectModeChange={onSelectModeChange}
      {...editorProps}
      {...extra}
    />
  );
  const utils = render(element(true));
  // The header's lit toggle (and a note switch, which resets the flag): the
  // mode belongs to the host, so it can go off without the editor being asked.
  const leaveMode = () => utils.rerender(element(false));
  return { onChange, onSelectModeChange, leaveMode, ...utils };
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

// The scroller measures at the origin in jsdom, so an x inside `SWEEP_RAIL_PX`
// is on the sweep rail and anything past it is the note's own scrolling body.
const RAIL_X = 8;
const BODY_X = 200;

function press(index: number, pointerType = "mouse", clientX = BODY_X) {
  fireEvent.pointerDown(surface().parentElement!, {
    pointerId: 1,
    pointerType,
    clientX,
    clientY: yOf(index),
  });
}

function moveTo(index: number, pointerType = "mouse", clientX = BODY_X) {
  fireEvent.pointerMove(surface().parentElement!, {
    pointerId: 1,
    pointerType,
    clientX,
    clientY: yOf(index),
  });
}

function release(index: number, pointerType = "mouse", clientX = BODY_X) {
  fireEvent.pointerUp(surface().parentElement!, {
    pointerId: 1,
    pointerType,
    clientX,
    clientY: yOf(index),
  });
}

/** A whole press-and-release on one line, which is how a line is toggled. */
function tap(index: number, pointerType = "mouse", clientX = BODY_X) {
  press(index, pointerType, clientX);
  release(index, pointerType, clientX);
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
    tap(2);
    expect(tinted()).toEqual([2]);
  });

  it("keeps what is already taken when another line is pressed", () => {
    const { onSelectModeChange } = renderEditor();
    layOutRows();
    tap(1);
    tap(3);
    expect(tinted()).toEqual([1, 3]);
    expect(onSelectModeChange).not.toHaveBeenCalled();
  });

  it("gives a line back when it is pressed a second time", () => {
    const { onSelectModeChange } = renderEditor();
    layOutRows();
    tap(1);
    tap(3);
    tap(1);
    expect(tinted()).toEqual([3]);
    // Dropping the last line leaves the mode standing, ready to pick again —
    // pressing a line is never the way out.
    tap(3);
    expect(tinted()).toEqual([]);
    expect(onSelectModeChange).not.toHaveBeenCalled();
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

  it("adds a dragged run to the lines already taken", () => {
    renderEditor();
    layOutRows();
    tap(0);
    press(2);
    moveTo(3);
    release(3);
    expect(tinted()).toEqual([0, 2, 3]);
  });

  it("erases with a stroke that starts on a line already taken", () => {
    renderEditor();
    layOutRows();
    press(0);
    moveTo(3);
    release(3);
    expect(tinted()).toEqual([0, 1, 2, 3]);
    // Starting on a taken line makes the same stroke give lines back.
    press(1);
    moveTo(2);
    release(2);
    expect(tinted()).toEqual([0, 3]);
  });

  it("tints the line number along with the text", () => {
    renderEditor({ lineNumbers: true });
    layOutRows();
    tap(1);
    const number = screen.getByRole("button", { name: "Select line 2" });
    expect(number.className).toContain("line-selected");
    expect(number.closest("[data-line-row]")?.className).toContain(
      "line-selected",
    );
  });

  it("leaves a touch outside the rail to the scroller", () => {
    renderEditor();
    layOutRows();
    press(1, "touch");
    // Nothing is taken on the way down: until the finger lifts there is no
    // telling a tap from the start of a scroll.
    expect(tinted()).toEqual([]);
    moveTo(3, "touch");
    release(3, "touch");
    // It travelled, so it was a scroll — and a scroll must not take a line.
    expect(tinted()).toEqual([]);
  });

  it("toggles the line a touch that never travelled lifts off", () => {
    renderEditor();
    layOutRows();
    press(1, "touch");
    release(1, "touch");
    expect(tinted()).toEqual([1]);
  });

  it("sweeps straight away when the touch starts on the rail", () => {
    renderEditor();
    layOutRows();
    press(1, "touch", RAIL_X);
    expect(tinted()).toEqual([1]);
    moveTo(3, "touch", RAIL_X);
    expect(tinted()).toEqual([1, 2, 3]);
  });

  it("draws a rail segment for every line, lit for the taken ones", () => {
    renderEditor();
    layOutRows();
    tap(1);
    const rails = rows().map((row) =>
      row.querySelector(".sweep-rail-on, .sweep-rail"),
    );
    expect(rails.every(Boolean)).toBe(true);
    expect(
      rails.map((rail) => rail?.classList.contains("sweep-rail-on")),
    ).toEqual([false, true, false, false]);
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

  it("hands nothing over when the lines taken aren't one run", () => {
    const { onSelectModeChange } = renderEditor();
    layOutRows();
    tap(0);
    tap(2);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onSelectModeChange).toHaveBeenCalledWith(false);
    // A browser range over 0–2 would quietly take the line between them.
    expect(window.getSelection()?.toString() ?? "").not.toContain("bravo");
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

  it("types over scattered lines without swallowing the ones it skipped", () => {
    const { onChange } = renderEditor();
    layOutRows();
    tap(0);
    tap(2);
    beforeInput("insertText", "X");
    expect(onChange).toHaveBeenCalledWith("X\nbravo\ndelta");
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

  it("deletes scattered lines and closes every gap they leave", () => {
    const { onChange } = renderEditor();
    layOutRows();
    tap(1);
    tap(3);
    fireEvent.keyDown(document, { key: "Backspace" });
    expect(onChange).toHaveBeenCalledWith("alpha\ncharlie");
  });

  it("walks the run with the arrow keys, extending on Shift", () => {
    renderEditor();
    layOutRows();
    tap(1);
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(tinted()).toEqual([2]);
    fireEvent.keyDown(document, { key: "ArrowDown", shiftKey: true });
    expect(tinted()).toEqual([2, 3]);
  });

  it("takes the whole note on Ctrl+A", () => {
    renderEditor();
    layOutRows();
    tap(1);
    fireEvent.keyDown(document, { key: "a", ctrlKey: true });
    expect(tinted()).toEqual([0, 1, 2, 3]);
  });

  it("reports the run to the host so the header can act on it", () => {
    const onSelectionChange = vi.fn();
    renderEditor({ onSelectionChange });
    layOutRows();
    tap(2);
    expect(onSelectionChange).toHaveBeenCalledWith(true);
  });

  it("takes the report back when the host turns the mode off", () => {
    const onSelectionChange = vi.fn();
    const { leaveMode } = renderEditor({ onSelectionChange });
    layOutRows();
    tap(2);
    expect(onSelectionChange).toHaveBeenLastCalledWith(true);

    // Nothing is selected once the run is dropped, and no `selectionchange` is
    // coming to say so — the mode left the caret collapsed and hidden. Left
    // unreported, the header keeps cut / copy / format pinned out over a note
    // with nothing in hand.
    leaveMode();
    expect(onSelectionChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps the report when the mode hands its run over as a selection", () => {
    const onSelectionChange = vi.fn();
    // The host answers the exit in the same event the way `Editor` does, so
    // the run being dropped and the mode going off land in one render.
    let leave = () => {};
    const { leaveMode } = renderEditor({
      onSelectionChange,
      onSelectModeChange: () => leave(),
    });
    leave = leaveMode;
    layOutRows();
    press(1);
    moveTo(2);
    release(2);
    expect(onSelectionChange).toHaveBeenLastCalledWith(true);

    // Escape hands the run over as an ordinary selection, so the actions it
    // earned survive the host switching the mode off behind it.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onSelectionChange).toHaveBeenLastCalledWith(true);
  });

  it("refuses to rewrite a locked note, but still lets the run be taken", () => {
    const { onChange } = renderEditor({ locked: true });
    layOutRows();
    tap(1);
    expect(tinted()).toEqual([1]);
    fireEvent.keyDown(document, { key: "Backspace" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("paints nothing while the mode is off", () => {
    renderEditor({ selectMode: false });
    layOutRows();
    tap(2);
    expect(tinted()).toEqual([]);
  });
});

describe("select mode's cut and delete verbs", () => {
  // Both are reached from the editor's header (`Editor` owns those buttons),
  // which holds this editor by its handle — so the handle is where they are
  // tested. The header half is in `note-editor.test.tsx`.
  function renderWithHandle() {
    const handleRef: { current: MarkdownEditorHandle | null } = {
      current: null,
    };
    return { handleRef, ...renderEditor({ handleRef }) };
  }

  function stubClipboard() {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    return writeText;
  }

  afterEach(() => Reflect.deleteProperty(navigator, "clipboard"));

  it("cuts the taken lines onto the clipboard and out of the note", () => {
    const writeText = stubClipboard();
    const { handleRef, onChange, onSelectModeChange } = renderWithHandle();
    layOutRows();
    tap(1);
    tap(3);

    handleRef.current?.cut();

    expect(writeText).toHaveBeenCalledWith("bravo\ndelta");
    expect(onChange).toHaveBeenCalledWith("alpha\ncharlie");
    expect(onSelectModeChange).toHaveBeenCalledWith(false);
  });

  it("deletes the taken lines without touching the clipboard", () => {
    const writeText = stubClipboard();
    const { handleRef, onChange, onSelectModeChange } = renderWithHandle();
    layOutRows();
    press(1);
    moveTo(2);
    release(2);

    handleRef.current?.deleteSelection();

    expect(onChange).toHaveBeenCalledWith("alpha\ndelta");
    expect(writeText).not.toHaveBeenCalled();
    // The lines it named are gone, so there is nothing left to hold.
    expect(onSelectModeChange).toHaveBeenCalledWith(false);
  });

  it("lets a delete pass when nothing is taken", () => {
    const { handleRef, onChange } = renderWithHandle();
    layOutRows();

    handleRef.current?.deleteSelection();

    expect(onChange).not.toHaveBeenCalled();
  });

  it("refuses a delete on a locked note", () => {
    const handleRef: { current: MarkdownEditorHandle | null } = {
      current: null,
    };
    const { onChange } = renderEditor({ locked: true, handleRef });
    layOutRows();
    tap(1);

    handleRef.current?.deleteSelection();

    expect(onChange).not.toHaveBeenCalled();
  });
});
