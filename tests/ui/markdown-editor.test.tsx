// @vitest-environment jsdom
import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  onTabOut: () => {},
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

  it("opens another quote row on Enter inside a quote", () => {
    const { onChange } = renderEditor("> quoted");
    caretIn(rawLine()!, 8);
    beforeInput("insertParagraph");
    expect(onChange).toHaveBeenLastCalledWith("> quoted\n> ");
  });

  it("quotes the tail when Enter splits a quote mid-row", () => {
    const { onChange } = renderEditor("> abcd");
    caretIn(rawLine()!, 4);
    beforeInput("insertParagraph");
    expect(onChange).toHaveBeenLastCalledWith("> ab\n> cd");
  });

  it("keeps quoting from an empty quote row", () => {
    // Leaving a quote is explicit — unmark the row, or move to another one.
    const { onChange } = renderEditor("> one\n> ");
    caretIn(rawLine()!, 2);
    beforeInput("insertParagraph");
    expect(onChange).toHaveBeenLastCalledWith("> one\n> \n> ");
  });

  it("does not quote the next row from an unquoted one", () => {
    const { onChange } = renderEditor("> quoted\nplain");
    caretIn(rawLine()!, 5);
    beforeInput("insertParagraph");
    expect(onChange).toHaveBeenLastCalledWith("> quoted\nplain\n");
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

  describe("fenced code blocks", () => {
    // The source lines actually rendered, in order — a hidden line is absent
    // from the DOM entirely (it stays in the source).
    function renderedIndices(): string[] {
      return [...surface().querySelectorAll("[data-line-index]")].map(
        (el) => el.getAttribute("data-line-index") ?? "",
      );
    }

    it("hides both fences of a closed block the caret is outside of", () => {
      // Caret opens on the trailing line 4, outside the block on lines 1–3.
      renderEditor("before\n```\ncode\n```\n");
      expect(renderedIndices()).toEqual(["0", "2", "4"]);
      expect(surface().textContent).not.toContain("```");
      // The code inside is still rendered, verbatim.
      expect(screen.getByText("code")).not.toBeNull();
    });

    it("reveals the fences once the caret steps inside the block", () => {
      renderEditor("before\n```\ncode\n```\n", { focusOnMount: false });
      caretIn(screen.getByText("code"), 0);
      act(() => document.dispatchEvent(new Event("selectionchange")));
      expect(renderedIndices()).toEqual(["0", "1", "2", "3", "4"]);
      expect(rawLine()?.getAttribute("data-line-index")).toBe("2");
      expect(surface().textContent).toContain("```");
    });

    it("keeps an unterminated fence on screen", () => {
      // No closing fence yet, so nothing is hidden even with the caret away.
      renderEditor("```\ncode", { focusOnMount: false });
      expect(renderedIndices()).toEqual(["0", "1"]);
      expect(surface().textContent).toContain("```");
    });

    it("hides every block's fences when no line is active", () => {
      renderEditor("```\na\n```\ntext\n```\nb\n```", { focusOnMount: false });
      expect(renderedIndices()).toEqual(["1", "3", "5"]);
    });

    // The button that copies a block. It hangs inside the block's first drawn
    // line, so its wrapper says which source line it is anchored to.
    function copyButtons(): HTMLElement[] {
      return [
        ...surface().querySelectorAll<HTMLElement>("button[aria-label]"),
      ].filter((el) => /copy code/i.test(el.getAttribute("aria-label") ?? ""));
    }

    function anchorOf(button: HTMLElement): string | null {
      return (
        button.closest("[data-line-index]")?.getAttribute("data-line-index") ??
        null
      );
    }

    it("hangs a copy button on the first drawn line of every closed block", () => {
      renderEditor("```\na\n```\ntext\n```\nb\n```", { focusOnMount: false });
      // The fences are folded away, so each button rides the block's code.
      expect(copyButtons().map(anchorOf)).toEqual(["1", "5"]);
    });

    it("gives an empty block and an unterminated fence no button", () => {
      renderEditor("```\n```\n```\ndangling", { focusOnMount: false });
      expect(copyButtons()).toHaveLength(0);
    });

    it("copies the block's code without its fences", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
      renderEditor("```sh\nnpm run build\nnpm test\n```", {
        focusOnMount: false,
      });
      await act(async () => {
        fireEvent.click(copyButtons()[0]!);
      });
      expect(writeText).toHaveBeenCalledWith("npm run build\nnpm test");
      vi.unstubAllGlobals();
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

  // A composition is the one edit the browser applies to the line itself, so
  // React's record of that line's children goes stale the moment it starts.
  // This is not only the IME case it sounds like: on the Nordic layouts `` ` ``
  // and `´` are dead keys, so typing a plain backtick composes — and used to
  // take the whole app down with a `removeChild` NotFoundError, because React
  // reconciled the line in place and tried to tear down the `<br>` the browser
  // had already swapped out. `composeInto` stands in for that native rewrite.
  describe("IME / dead-key composition", () => {
    function composeInto(line: HTMLElement, text: string) {
      act(() => {
        fireEvent.compositionStart(surface());
      });
      // The browser rewrites the line's children itself — on an empty line that
      // means dropping the lone <br> React rendered there.
      line.textContent = text;
      act(() => {
        fireEvent.compositionEnd(surface(), { data: text });
      });
    }

    it("takes a dead-key backtick on an empty line without crashing", () => {
      const { onChange, container } = renderEditor("");
      const raw = rawLine()!;
      expect(raw.querySelector("br")).not.toBeNull();

      composeInto(raw, "`");

      expect(onChange).toHaveBeenLastCalledWith("`");
      expect(rawLine()?.textContent).toBe("`");
      expect(container.querySelector("[data-raw] br")).toBeNull();
    });

    it("takes a composed character mid-note without crashing", () => {
      const { onChange } = renderEditor("alpha\n");
      // The caret opens on the trailing (empty) last line.
      composeInto(rawLine()!, "à");
      expect(onChange).toHaveBeenLastCalledWith("alpha\nà");

      // And again on the now non-empty line, so the second composition
      // reconciles against a line React last rendered as text.
      composeInto(rawLine()!, "àb");
      expect(onChange).toHaveBeenLastCalledWith("alpha\nàb");
    });

    it("rebuilds the line but reports no edit when composition changes nothing", () => {
      const { onChange } = renderEditor("alpha");
      // A composition the user cancelled: the browser touched the line, but it
      // resolved back to the text already in the source.
      composeInto(rawLine()!, "alpha");
      // The unchanged document is never pushed through onChange (it would bump
      // the note's updatedAt for a keystroke that changed nothing)…
      expect(onChange).not.toHaveBeenCalled();
      // …but the line is still on screen and editable.
      expect(rawLine()?.textContent).toBe("alpha");
    });
  });

  describe("tab order", () => {
    it("reports Tab up instead of indenting, and stays out of the tab order", () => {
      // The host places the editor between the title and the header actions —
      // document order can't, so the surface itself is never a tab stop.
      const onTabOut = vi.fn();
      renderEditor("one", { onTabOut });
      expect(surface().tabIndex).toBe(-1);

      fireEvent.keyDown(surface(), { key: "Tab" });
      expect(onTabOut).toHaveBeenLastCalledWith(false);

      fireEvent.keyDown(surface(), { key: "Tab", shiftKey: true });
      expect(onTabOut).toHaveBeenLastCalledWith(true);
    });

    it("leaves Tab alone on a tab stop inside the note", () => {
      // An attachment thumbnail is its own tab stop; its Tab bubbles through
      // the surface's handler and must keep the browser's own behaviour.
      const onTabOut = vi.fn();
      const { container } = renderEditor("one", { onTabOut });
      const inner = document.createElement("button");
      container.querySelector('[data-line-index="0"]')!.append(inner);

      fireEvent.keyDown(inner, { key: "Tab" });
      expect(onTabOut).not.toHaveBeenCalled();
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

  describe("where a press lands the caret", () => {
    // A touch press also arms the soft-keyboard reveal, which scrolls the line
    // it lands on; jsdom has no `scrollIntoView`.
    const originalScroll = HTMLElement.prototype.scrollIntoView;
    beforeEach(() => {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    });
    afterEach(() => {
      HTMLElement.prototype.scrollIntoView = originalScroll;
    });

    // A press arrives as a pointerdown (which says what pressed) followed by a
    // click (by which time the browser has placed its own caret — stood in for
    // here by `caretIn` / `caretAt`, since jsdom does no hit-testing).
    function press(target: Element, pointerType: "touch" | "mouse") {
      fireEvent.pointerDown(surface(), { pointerType });
      fireEvent.click(target, { detail: 1 });
    }

    // Point the collapsed caret at `offset` inside an arbitrary text node.
    function caretAt(node: Node, offset: number) {
      const sel = window.getSelection()!;
      const range = document.createRange();
      range.setStart(node, offset);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    /** The caret's offset within the raw active line. */
    function caretOffset(): number {
      return window.getSelection()!.anchorOffset;
    }

    it("snaps a touch tap to the end of the word it hit", () => {
      renderEditor("hello world");
      caretIn(rawLine()!, 2);
      press(rawLine()!, "touch");
      expect(caretOffset()).toBe(5);
    });

    it("keeps the exact column a mouse click landed on", () => {
      renderEditor("hello world");
      caretIn(rawLine()!, 2);
      press(rawLine()!, "mouse");
      expect(caretOffset()).toBe(2);
    });

    it("leaves a touch tap that landed on whitespace where it is", () => {
      renderEditor("hello world");
      caretIn(rawLine()!, 5);
      press(rawLine()!, "touch");
      expect(caretOffset()).toBe(5);
    });

    it("snaps a tap on a formatted line, opening it raw at the word end", () => {
      renderEditor("hello world\nsecond");
      const word = screen.getByText("hello world");
      caretAt(word.firstChild!, 2);
      press(word, "touch");
      // The tapped line is now the raw active line, caret past "hello".
      expect(rawLine()?.getAttribute("data-line-index")).toBe("0");
      expect(caretOffset()).toBe(5);
    });

    it("lands at the end of a horizontal rule so it can be erased", () => {
      // A rule renders as a lone <hr> with no text to anchor a caret in, so the
      // browser leaves the caret elsewhere and a phone (no forward-delete key)
      // could never remove the line. The press takes the end of it instead.
      const { container } = renderEditor("---\nsecond");
      const rule = container.querySelector("hr")!;
      press(rule, "touch");
      expect(rawLine()?.getAttribute("data-line-index")).toBe("0");
      expect(rawLine()?.textContent).toBe("---");
      expect(caretOffset()).toBe(3);
    });

    it("lands at the end of a horizontal rule for a mouse too", () => {
      const { container } = renderEditor("---\nsecond");
      press(container.querySelector("hr")!, "mouse");
      expect(rawLine()?.getAttribute("data-line-index")).toBe("0");
      expect(caretOffset()).toBe(3);
    });

    it("leaves a ranged selection the press ended on alone", () => {
      // A drag-select (or a double-click's word) must keep exactly what the
      // browser drew rather than collapsing to a word end.
      renderEditor("hello world");
      const line = rawLine()!;
      const sel = window.getSelection()!;
      const range = document.createRange();
      range.setStart(line.firstChild!, 0);
      range.setEnd(line.firstChild!, 5);
      sel.removeAllRanges();
      sel.addRange(range);
      press(line, "touch");
      expect(sel.isCollapsed).toBe(false);
      expect(sel.toString()).toBe("hello");
    });

    it("leaves the caret alone when the press opened a link", () => {
      // The link handler answers the press (`preventDefault`) and opens the
      // URL; the caret must not be dragged onto the link's line behind it.
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      try {
        renderEditor("[google](https://example.com)\nplain");
        press(screen.getByText("google"), "touch");
        expect(open).toHaveBeenCalled();
        expect(rawLine()?.getAttribute("data-line-index")).toBe("1");
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

  describe("cutting", () => {
    // Ctrl/Cmd+K on the surface; the header button reaches the same code
    // through the editor's imperative handle.
    function ctrlK() {
      act(() => {
        fireEvent.keyDown(surface(), { key: "k", ctrlKey: true });
      });
    }

    it("cuts the caret's line whole from its start", () => {
      // The caret opens on the last line, so that is the one that goes.
      const { onChange } = renderEditor("one\ntwo\nthree");
      caretIn(rawLine()!, 0);
      ctrlK();
      expect(onChange).toHaveBeenLastCalledWith("one\ntwo");
    });

    it("cuts only the text after a mid-line caret", () => {
      const { onChange } = renderEditor("keep this. drop this.");
      caretIn(rawLine()!, 11);
      ctrlK();
      expect(onChange).toHaveBeenLastCalledWith("keep this. ");
    });

    it("puts what it took on the clipboard", () => {
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      renderEditor("one\ntwo\nthree");
      caretIn(rawLine()!, 0);
      ctrlK();
      // The caret opens on the last line, and a whole line is cut with its
      // newline so pasting it back makes a line again.
      expect(writeText).toHaveBeenCalledWith("three\n");
      Reflect.deleteProperty(navigator, "clipboard");
    });

    it("leaves the note alone when there is nothing to cut", () => {
      const { onChange } = renderEditor("");
      caretIn(rawLine()!, 0);
      ctrlK();
      expect(onChange).not.toHaveBeenCalled();
    });

    it("keeps the cut line's replacement active for editing", () => {
      renderEditor("one\ntwo");
      caretIn(rawLine()!, 0);
      ctrlK();
      // "one" moved up into the gap and is the line now being edited.
      expect(rawLine()?.textContent).toBe("one");
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
  describe("find-in-note highlights", () => {
    it("marks every hit and singles out the active one", () => {
      renderEditor("alpha beta\ngamma alpha", {
        focusOnMount: false,
        matches: [
          { line: 0, from: 0, to: 5 },
          { line: 1, from: 6, to: 11 },
        ],
        activeMatch: 1,
      });
      const marks = surface().querySelectorAll("mark");
      expect(marks.length).toBe(2);
      expect([...marks].map((m) => m.textContent)).toEqual(["alpha", "alpha"]);
      // The hit the bar is parked on wears the accent; the other the quieter
      // "also matches" tint.
      expect(marks[0]!.className).toContain("bg-link");
      expect(marks[1]!.className).toContain("bg-accent");
    });

    it("stamps each segment with its own source column", () => {
      renderEditor("alpha beta", {
        focusOnMount: false,
        matches: [{ line: 0, from: 6, to: 10 }],
        activeMatch: 0,
      });
      // The mark and the text before it are siblings, each carrying the column
      // it starts at — a caret / selection inside either maps back correctly.
      const mark = surface().querySelector("mark")!;
      expect(mark.getAttribute("data-src")).toBe("6");
      expect(mark.previousElementSibling?.getAttribute("data-src")).toBe("0");
    });

    it("renders no extra nodes when nothing matches", () => {
      renderEditor("alpha beta", { focusOnMount: false });
      expect(surface().querySelectorAll("mark").length).toBe(0);
    });
  });

  describe("line numbers", () => {
    // The gutter's press targets, in document order.
    function gutter(): HTMLElement[] {
      return [
        ...surface().querySelectorAll<HTMLElement>(
          "button[aria-label^='Select line']",
        ),
      ];
    }

    it("renders nothing extra while the setting is off", () => {
      renderEditor("one\ntwo", { focusOnMount: false });
      expect(gutter().length).toBe(0);
      // Every line element is still a direct child of the surface — the DOM the
      // editor has always rendered.
      for (const el of surface().querySelectorAll("[data-line-index]"))
        expect(el.parentElement).toBe(surface());
    });

    it("numbers every rendered line from one", () => {
      renderEditor("one\ntwo\nthree", {
        focusOnMount: false,
        lineNumbers: true,
      });
      expect(gutter().map((b) => b.textContent)).toEqual(["1", "2", "3"]);
    });

    it("keeps the number out of the line's own text", () => {
      // A digit inside the line element would shift every source column by its
      // width, so the button must be a sibling of `[data-line-index]`.
      renderEditor("hello", { lineNumbers: true });
      expect(rawLine()?.textContent).toBe("hello");
      expect(surface().querySelector("[data-line-index]")).not.toBe(
        gutter()[0]!.parentElement,
      );
    });

    it("selects the whole line when its number is pressed", () => {
      renderEditor("alpha\nbeta", { focusOnMount: false, lineNumbers: true });
      act(() => {
        fireEvent.mouseDown(gutter()[0]!);
      });
      const sel = window.getSelection()!;
      expect(sel.isCollapsed).toBe(false);
      expect(sel.toString()).toBe("alpha");
    });

    it("drops the active raw line so the selection covers the formatted one", () => {
      // The caret opens on the last line (raw); pressing another line's number
      // takes the whole note back to formatted and selects that line.
      renderEditor("**bold**\nplain", { lineNumbers: true });
      expect(rawLine()).not.toBeNull();
      act(() => {
        fireEvent.mouseDown(gutter()[0]!);
      });
      expect(rawLine()).toBeNull();
      expect(window.getSelection()!.toString()).toBe("bold");
    });

    it("cuts the pressed line through the editor's own cut", () => {
      // The selection a press draws is an ordinary ranged one, so everything
      // that reads the selection — cut, copy, typing over it — sees it.
      const { onChange } = renderEditor("alpha\nbeta", {
        focusOnMount: false,
        lineNumbers: true,
      });
      act(() => {
        fireEvent.mouseDown(gutter()[0]!);
      });
      beforeInput("insertText", "X");
      expect(onChange).toHaveBeenLastCalledWith("X\nbeta");
    });
  });
});
