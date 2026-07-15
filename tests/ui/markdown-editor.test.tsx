// @vitest-environment jsdom
import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownEditor } from "../../src/ui/MarkdownEditor.tsx";
import {
  getEditorPosition,
  resetEditorPositions,
  setEditorPosition,
} from "../../src/ui/editor-position.ts";

const editorProps = {
  wordWrap: true,
  disableSpellcheck: false,
  disableAutocorrect: false,
  maxWidth: "none",
} as const;

function renderEditor(body: string, extra?: Record<string, unknown>) {
  const onChange = vi.fn();
  const utils = render(
    <MarkdownEditor
      body={body}
      onChange={onChange}
      {...editorProps}
      {...extra}
    />,
  );
  return { onChange, ...utils };
}

// The single contenteditable surface; the whole note is one editable element.
function surface(): HTMLElement {
  return screen.getByRole("textbox");
}

// The active line renders as raw source and is stamped `data-raw`.
function rawLine(): HTMLElement | null {
  return surface().querySelector("[data-raw]");
}

// Point the collapsed caret at `offset` inside a line element's first text node.
function caretIn(lineEl: HTMLElement, offset: number) {
  const node = lineEl.firstChild ?? lineEl;
  const sel = window.getSelection()!;
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

// Dispatch a native `beforeinput` (how the editor receives Enter / Backspace /
// Delete and mobile edits), which the editor turns into a source splice.
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

describe("MarkdownEditor", () => {
  it("renders every non-active line as formatted Markdown", () => {
    // Two lines; the caret opens on the last, so the first renders formatted.
    renderEditor("**bold**\nplain");
    expect(screen.getByText("bold").closest("strong")).not.toBeNull();
    // The active (last) line shows its raw source in the raw line.
    expect(rawLine()?.textContent).toBe("plain");
    expect(rawLine()?.getAttribute("data-line-index")).toBe("1");
  });

  it("splits the line on Enter at the caret", () => {
    const { onChange } = renderEditor("hello");
    caretIn(rawLine()!, 2);
    beforeInput("insertParagraph");
    expect(onChange).toHaveBeenLastCalledWith("he\nllo");
  });

  it("splits the line on a mobile insertLineBreak", () => {
    const { onChange } = renderEditor("hello");
    caretIn(rawLine()!, 2);
    beforeInput("insertLineBreak");
    expect(onChange).toHaveBeenLastCalledWith("he\nllo");
  });

  it("merges into the previous line on Backspace at column 0", () => {
    const { onChange } = renderEditor("a\nb");
    const raw = rawLine()!;
    expect(raw.textContent).toBe("b"); // caret opens on the last line
    caretIn(raw, 0);
    beforeInput("deleteContentBackward");
    expect(onChange).toHaveBeenLastCalledWith("ab");
  });

  it("deletes the character after the caret on Delete mid-line", () => {
    const { onChange } = renderEditor("abc");
    caretIn(rawLine()!, 1);
    beforeInput("deleteContentForward");
    // The editor fully controls the DOM: it removes the character itself.
    expect(onChange).toHaveBeenLastCalledWith("ac");
  });

  it("deletes the character before the caret on Backspace mid-line", () => {
    const { onChange } = renderEditor("a\nbc");
    caretIn(rawLine()!, 1);
    beforeInput("deleteContentBackward");
    expect(onChange).toHaveBeenLastCalledWith("a\nc");
  });

  it("inserts typed text through the engine (fully controlled)", () => {
    const { onChange } = renderEditor("ac");
    caretIn(rawLine()!, 1);
    beforeInput("insertText", "b");
    expect(onChange).toHaveBeenLastCalledWith("abc");
  });

  it("adopts an out-of-band change to the body prop", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MarkdownEditor body="first" onChange={onChange} {...editorProps} />,
    );
    expect(rawLine()?.textContent).toBe("first");

    rerender(
      <MarkdownEditor
        body={"first\nfrom another device"}
        onChange={onChange}
        {...editorProps}
      />,
    );

    expect(screen.getByText("from another device")).not.toBeNull();
    // Adopting a remote change must not be reported back as a local edit.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows the start-writing placeholder for an empty note", () => {
    renderEditor("", { focusOnMount: false });
    expect(screen.getByText(/start writing/i)).not.toBeNull();
  });

  describe("undo / redo reveal", () => {
    // jsdom has no layout, so pin the geometry: the scroll container (no
    // data-line-index) sits at 0–100, every line sits at 500–520 (off screen),
    // so a line the undo touched is always judged out of view and scrolled to.
    function mockLayout() {
      const original = HTMLElement.prototype
        .getBoundingClientRect as typeof HTMLElement.prototype.getBoundingClientRect;
      HTMLElement.prototype.getBoundingClientRect = function (
        this: HTMLElement,
      ) {
        const offScreen = this.hasAttribute("data-line-index");
        return {
          top: offScreen ? 500 : 0,
          bottom: offScreen ? 520 : 100,
          left: 0,
          right: 0,
          width: 0,
          height: offScreen ? 20 : 100,
          x: 0,
          y: offScreen ? 500 : 0,
          toJSON: () => ({}),
        } as DOMRect;
      };
      const scrollIntoView = vi.fn();
      const originalScroll = HTMLElement.prototype.scrollIntoView;
      HTMLElement.prototype.scrollIntoView = scrollIntoView;
      const restore = () => {
        HTMLElement.prototype.getBoundingClientRect = original;
        HTMLElement.prototype.scrollIntoView = originalScroll;
      };
      return { scrollIntoView, restore };
    }

    it("scrolls the first changed line into view when the seq advances", () => {
      const { scrollIntoView, restore } = mockLayout();
      try {
        const onChange = vi.fn();
        const { rerender } = render(
          <MarkdownEditor
            body={"alpha\nbravo\ncharlie"}
            onChange={onChange}
            undoScrollSeq={0}
            focusOnMount={false}
            {...editorProps}
          />,
        );
        expect(scrollIntoView).not.toHaveBeenCalled();

        // An undo swaps the body and ticks the seq in the same commit.
        rerender(
          <MarkdownEditor
            body={"alpha\nBRAVO\ncharlie"}
            onChange={onChange}
            undoScrollSeq={1}
            focusOnMount={false}
            {...editorProps}
          />,
        );

        const changed = surface().querySelector('[data-line-index="1"]');
        expect(scrollIntoView).toHaveBeenCalledTimes(1);
        expect(scrollIntoView.mock.instances[0]).toBe(changed);
      } finally {
        restore();
      }
    });

    it("does not scroll when the body changes without a seq bump", () => {
      const { scrollIntoView, restore } = mockLayout();
      try {
        const onChange = vi.fn();
        const { rerender } = render(
          <MarkdownEditor
            body={"alpha\nbravo\ncharlie"}
            onChange={onChange}
            undoScrollSeq={0}
            focusOnMount={false}
            {...editorProps}
          />,
        );

        // A live cloud pull changes the body but never ticks the undo seq.
        rerender(
          <MarkdownEditor
            body={"alpha\nBRAVO\ncharlie"}
            onChange={onChange}
            undoScrollSeq={0}
            focusOnMount={false}
            {...editorProps}
          />,
        );

        expect(scrollIntoView).not.toHaveBeenCalled();
      } finally {
        restore();
      }
    });
  });

  describe("opening without focus (focusOnMount=false)", () => {
    it("renders the whole note formatted with no raw line on open", () => {
      renderEditor("**bold**\nplain", { focusOnMount: false });
      // No line is active, so nothing renders as raw source.
      expect(rawLine()).toBeNull();
      expect(screen.getByText("bold").closest("strong")).not.toBeNull();
      expect(screen.getByText("plain")).not.toBeNull();
    });

    it("renders a single-line note formatted on open", () => {
      renderEditor("# Heading", { focusOnMount: false });
      expect(rawLine()).toBeNull();
      const heading = screen.getByText("Heading");
      expect(heading).not.toBeNull();
      expect(heading.closest("[data-raw]")).toBeNull();
    });

    it("makes the caret's line active (raw) when the selection lands on it", () => {
      renderEditor("**bold**\nplain", { focusOnMount: false });
      expect(rawLine()).toBeNull();
      const plain = screen.getByText("plain");
      caretIn(plain.firstChild as unknown as HTMLElement, 2);
      act(() => document.dispatchEvent(new Event("selectionchange")));
      // Line 1 is now the active raw line showing its source.
      const raw = rawLine();
      expect(raw?.getAttribute("data-line-index")).toBe("1");
      expect(raw?.textContent).toBe("plain");
      // The other line stays formatted.
      expect(screen.getByText("bold").closest("strong")).not.toBeNull();
    });
  });

  describe("blur reformats the note", () => {
    it("renders a trailing lone hyphen as a rule once the body loses focus", async () => {
      const { container } = renderEditor("text\n-");
      // The caret opens on the last line, so the trailing `-` shows as raw
      // source rather than a horizontal rule.
      expect(container.querySelector("[data-raw]")?.textContent).toBe("-");
      expect(container.querySelector("hr")).toBeNull();

      // Focus moves out of the body (to the title field / a header button): the
      // active line must clear so the whole note renders formatted — the trailing
      // dash is now a rule, not a literal `-`. (A plain <button> so it doesn't
      // also match the editor's `textbox` role.)
      const other = document.createElement("button");
      document.body.appendChild(other);
      try {
        await act(async () => {
          other.focus();
        });
        expect(container.querySelector("[data-raw]")).toBeNull();
        expect(container.querySelector("hr")).not.toBeNull();
      } finally {
        other.remove();
      }
    });
  });

  describe("select all", () => {
    it("selects the whole note (all lines) on Ctrl+A", () => {
      renderEditor("one\ntwo\nthree");
      fireEvent.keyDown(surface(), { key: "a", ctrlKey: true });
      const sel = window.getSelection()!;
      // The selection spans from the first line to the last — endpoints anchored
      // inside line elements so they map back to source.
      const first = surface().querySelector('[data-line-index="0"]')!;
      const last = surface().querySelector('[data-line-index="2"]')!;
      expect(sel.containsNode(first, true)).toBe(true);
      expect(sel.containsNode(last, true)).toBe(true);
    });

    it("routes Ctrl+A pressed with nothing focused into the editor", () => {
      // An existing note opens with no focus at all (focusOnMount={false}), so
      // the shortcut lands on the body; the fallback must scope it to the note
      // and take focus so the selection can be typed over or cut.
      renderEditor("one\ntwo\nthree", { focusOnMount: false });
      expect(document.activeElement).toBe(document.body);
      fireEvent.keyDown(document.body, { key: "a", ctrlKey: true });
      const sel = window.getSelection()!;
      const first = surface().querySelector('[data-line-index="0"]')!;
      const last = surface().querySelector('[data-line-index="2"]')!;
      expect(sel.containsNode(first, true)).toBe(true);
      expect(sel.containsNode(last, true)).toBe(true);
      expect(document.activeElement).toBe(surface());
    });

    it("leaves Ctrl+A alone while another editable field holds focus", () => {
      // Focus in e.g. the title textarea keeps the browser's native
      // field-scoped select-all — the note body must not steal it.
      renderEditor("one\ntwo", { focusOnMount: false });
      const input = document.createElement("input");
      document.body.appendChild(input);
      try {
        input.focus();
        fireEvent.keyDown(input, { key: "a", ctrlKey: true });
        const sel = window.getSelection()!;
        expect(sel.rangeCount === 0 || sel.isCollapsed).toBe(true);
        expect(document.activeElement).toBe(input);
      } finally {
        input.remove();
      }
    });
  });

  describe("links", () => {
    it("opens a link on click instead of entering edit mode on its line", () => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      try {
        renderEditor("[google](https://example.com)\nplain");
        const link = screen.getByText("google");
        expect(link.closest("a")?.getAttribute("href")).toBe(
          "https://example.com",
        );
        fireEvent.click(link);
        expect(open).toHaveBeenCalledWith(
          "https://example.com",
          "_blank",
          "noreferrer,noopener",
        );
        // The link's line stayed formatted (the anchor is still in the DOM).
        expect(screen.getByText("google").closest("a")).not.toBeNull();
      } finally {
        open.mockRestore();
      }
    });
  });

  describe("session position restore", () => {
    it("reopens a note at the remembered caret line", () => {
      // A position left earlier this session for this note id.
      setEditorPosition("keep", { caret: { line: 0, col: 2 }, scrollTop: 0 });
      // An existing note mounts with nothing focused (focusOnMount=false), yet
      // the remembered caret reopens line 0 as the raw active line.
      renderEditor("alpha\nbravo\ncharlie", {
        noteId: "keep",
        focusOnMount: false,
      });
      expect(rawLine()?.getAttribute("data-line-index")).toBe("0");
      expect(rawLine()?.textContent).toBe("alpha");
    });

    it("opens fresh (no active line) for a note with no remembered position", () => {
      renderEditor("alpha\nbravo", { noteId: "unseen", focusOnMount: false });
      // focusOnMount=false and nothing remembered → fully formatted, no raw line.
      expect(rawLine()).toBeNull();
    });

    it("stashes the caret when the editor unmounts", () => {
      // Opens focused on the last line; type a character so an edit runs through
      // the source engine and updates the remembered caret.
      const { unmount } = renderEditor("alpha\nbravo", { noteId: "save" });
      caretIn(rawLine()!, 5);
      beforeInput("insertText", "!");
      unmount();
      // The unmount handler wrote the last caret (line 1) into the store.
      expect(getEditorPosition("save")?.caret?.line).toBe(1);
    });
  });

  describe("clicking the empty space below", () => {
    it("lands the caret at the end without reporting an edit", () => {
      const { onChange, container } = renderEditor(
        "![img](attachments/a.png)",
        { canAttach: true },
      );
      const scroll = container.firstElementChild as HTMLElement;
      act(() => {
        fireEvent.mouseDown(scroll, { target: scroll });
      });
      // A fresh trailing line is opened for editing, but placing the caret is
      // not an edit — the unchanged document is never pushed through onChange.
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
