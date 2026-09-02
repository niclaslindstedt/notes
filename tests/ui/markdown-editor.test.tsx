// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "../../src/ui/MarkdownEditor.tsx";
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

// Point the collapsed caret at column `offset` of a line element's text.
//
// The active line is a run of styled spans over its raw source (`RawLine`), so
// a column doesn't necessarily land in the first child — this walks the text
// nodes to find the one holding it, the same way the editor's own `placeCaret`
// does.
function domPointIn(
  lineEl: HTMLElement,
  offset: number,
): { node: Node; offset: number } {
  const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let text = walker.nextNode() as Text | null;
  while (text) {
    if (remaining <= text.data.length) return { node: text, offset: remaining };
    remaining -= text.data.length;
    text = walker.nextNode() as Text | null;
  }
  return { node: lineEl, offset: remaining };
}

function caretIn(lineEl: HTMLElement, offset: number) {
  const at = domPointIn(lineEl, offset);
  const sel = window.getSelection()!;
  const range = document.createRange();
  range.setStart(at.node, at.offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Select `[from, to)` of a line element's text — the ranged sibling of `caretIn`. */
function selectRange(lineEl: HTMLElement, from: number, to: number) {
  const a = domPointIn(lineEl, from);
  const b = domPointIn(lineEl, to);
  const sel = window.getSelection()!;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
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

// The same, with the target range the browser scopes an edit to — how a phone's
// autocorrect (and a desktop spellcheck replacement) says *which* word it is
// rewriting. jsdom's `InputEvent` takes no `targetRanges`, and the editor only
// reads the four boundary fields, so the range is stood in for by hand.
function beforeInputOver(
  inputType: string,
  data: string | null,
  lineEl: HTMLElement,
  from: number,
  to: number,
) {
  const a = domPointIn(lineEl, from);
  const b = domPointIn(lineEl, to);
  const e = new InputEvent("beforeinput", {
    inputType,
    data,
    cancelable: true,
    bubbles: true,
  });
  Object.defineProperty(e, "getTargetRanges", {
    value: () => [
      {
        startContainer: a.node,
        startOffset: a.offset,
        endContainer: b.node,
        endOffset: b.offset,
      },
    ],
  });
  act(() => {
    surface().dispatchEvent(e);
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

  it("opens another bullet on Enter inside a list", () => {
    const { onChange } = renderEditor("- one");
    caretIn(rawLine()!, 5);
    beforeInput("insertParagraph");
    expect(onChange).toHaveBeenLastCalledWith("- one\n- ");
  });

  it("bumps the number on Enter inside an ordered list", () => {
    const { onChange } = renderEditor("1. one");
    caretIn(rawLine()!, 6);
    beforeInput("insertParagraph");
    expect(onChange).toHaveBeenLastCalledWith("1. one\n2. ");
  });

  it("leaves the list on Enter from an empty item", () => {
    const { onChange } = renderEditor("- one\n  - ");
    caretIn(rawLine()!, 4);
    // The first press pulls the nested item back out a level…
    beforeInput("insertParagraph");
    expect(onChange).toHaveBeenLastCalledWith("- one\n- ");
    caretIn(rawLine()!, 2);
    // …the next clears the row entirely.
    beforeInput("insertParagraph");
    expect(onChange).toHaveBeenLastCalledWith("- one\n");
  });

  it("opens a row inside the item on Shift+Enter", () => {
    const { onChange } = renderEditor("- one");
    caretIn(rawLine()!, 5);
    fireEvent.keyDown(surface(), { key: "Enter", shiftKey: true });
    beforeInput("insertParagraph");
    expect(onChange).toHaveBeenLastCalledWith("- one\n  ");
  });

  it("does not carry a Shift+Enter over to a later plain Enter", () => {
    // Only a keydown sets the soft-break flag, so an edit arriving without one
    // — a soft keyboard, an autocorrect commit, a dictated break — would
    // otherwise inherit the last physical press's Shift.
    const { onChange } = renderEditor("- one");
    caretIn(rawLine()!, 5);
    fireEvent.keyDown(surface(), { key: "Enter", shiftKey: true });
    beforeInput("insertParagraph");
    expect(onChange).toHaveBeenLastCalledWith("- one\n  ");

    // Put the caret back on the bullet itself, then break with no keydown at
    // all: a new bullet, not another continuation row.
    caretIn(screen.getByText("one").firstChild as unknown as HTMLElement, 3);
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    beforeInput("insertParagraph");
    expect(onChange).toHaveBeenLastCalledWith("- one\n- \n  ");
  });

  it("does not quote the next row from an unquoted one", () => {
    const { onChange } = renderEditor("> quoted\nplain");
    caretIn(rawLine()!, 5);
    beforeInput("insertParagraph");
    expect(onChange).toHaveBeenLastCalledWith("> quoted\nplain\n");
  });

  // Holding the eraser: the caret is placed from a layout effect, the instant
  // after React has rewritten the line and so before the browser has laid the
  // new text out. WebKit goes on painting it at the rect the *previous* text
  // gave it — the caret drawn a row or two from the text being erased, while
  // the erasing itself stays exactly where the source says it is. The editor
  // takes the caret again a frame later, once that layout has landed.
  describe("the caret re-taken a frame after an edit", () => {
    /** Run the animation frame the editor queued the correction in. */
    async function nextFrame() {
      await act(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve());
          }),
      );
    }

    /** The caret's column within the active raw line. */
    function caretColumn(): number {
      const sel = window.getSelection()!;
      const range = document.createRange();
      range.setStart(rawLine()!, 0);
      range.setEnd(sel.anchorNode!, sel.anchorOffset);
      return range.toString().length;
    }

    it("re-asserts the caret the edit left, without moving it", async () => {
      renderEditor("hello world");
      caretIn(rawLine()!, 5);
      const addRange = vi.spyOn(Selection.prototype, "addRange");
      beforeInput("deleteContentBackward");
      const placed = addRange.mock.calls.length;

      await nextFrame();

      expect(addRange.mock.calls.length).toBe(placed + 1);
      addRange.mockRestore();
      expect(rawLine()?.textContent).toBe("hell world");
      expect(window.getSelection()!.isCollapsed).toBe(true);
      expect(caretColumn()).toBe(4);
    });

    it("leaves a selection drawn since the edit alone", async () => {
      renderEditor("hello world");
      caretIn(rawLine()!, 5);
      beforeInput("deleteContentBackward");
      selectRange(rawLine()!, 0, 4);

      await nextFrame();

      const sel = window.getSelection()!;
      expect(sel.isCollapsed).toBe(false);
      expect(sel.toString()).toBe("hell");
    });
  });

  it("merges into the previous line on Backspace at column 0", () => {
    const { onChange } = renderEditor("a\nb");
    const raw = rawLine()!;
    expect(raw.textContent).toBe("b"); // caret opens on the last line
    caretIn(raw, 0);
    beforeInput("deleteContentBackward");
    expect(onChange).toHaveBeenLastCalledWith("ab");
  });

  // Erasing a whole note on iOS: the selection callout's "Select All" anchors
  // its range on the editing host itself, not inside a line, and Backspace then
  // arrives as an ordinary delete. The editor has to map it and splice the
  // source; letting it through instead has WebKit erase the surface React owns,
  // and the next render throws and blanks the app until it's restarted cold.
  describe("erasing the whole note from a surface-anchored selection", () => {
    // A selection the browser drew across the whole editing host.
    function selectSurface() {
      const root = surface();
      const sel = window.getSelection()!;
      const range = document.createRange();
      range.setStart(root, 0);
      range.setEnd(root, root.childNodes.length);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    it("empties the note through the engine", () => {
      const { onChange } = renderEditor("alpha\nbeta\ngamma", {
        focusOnMount: false,
      });
      selectSurface();
      beforeInput("deleteContentBackward");
      expect(onChange).toHaveBeenLastCalledWith("");
    });

    it("takes the delete from the browser", () => {
      renderEditor("alpha\nbeta", { focusOnMount: false });
      selectSurface();
      const e = new InputEvent("beforeinput", {
        inputType: "deleteContentBackward",
        cancelable: true,
        bubbles: true,
      });
      act(() => {
        surface().dispatchEvent(e);
      });
      expect(e.defaultPrevented).toBe(true);
    });

    it("types over the selection rather than letting the browser replace it", () => {
      const { onChange } = renderEditor("alpha\nbeta", { focusOnMount: false });
      selectSurface();
      beforeInput("insertText", "X");
      expect(onChange).toHaveBeenLastCalledWith("X");
    });

    // The belt to the mapping's braces: an edit that still can't be expressed
    // as a source splice is refused outright, never handed to the browser.
    it("refuses an edit it cannot map at all", () => {
      renderEditor("alpha", { focusOnMount: false });
      window.getSelection()!.removeAllRanges();
      const e = new InputEvent("beforeinput", {
        inputType: "deleteContentBackward",
        cancelable: true,
        bubbles: true,
      });
      act(() => {
        surface().dispatchEvent(e);
      });
      expect(e.defaultPrevented).toBe(true);
    });
  });

  // A note erased down to the "start writing" prompt, then Backspaced again,
  // then blurred by dismissing the soft keyboard — the reported sequence. The
  // last two steps must leave the source alone and, above all, must not hand
  // the browser an edit at the very start of the document, where the only thing
  // to delete is whatever sits before the first line.
  describe("an already-empty note", () => {
    it("draws the prompt outside the editing host", () => {
      renderEditor("", { focusOnMount: false });
      // The host holds lines and nothing the browser can normalise away: a
      // `contenteditable={false}` island inside it is a node React has to
      // remove again on the first keystroke, and a `removeChild` of a node the
      // browser has already moved unmounts the app.
      expect(
        surface().querySelector("[contenteditable=false]")?.textContent,
      ).not.toBe("Start writing…");
      expect(screen.getByText("Start writing…")).toBeTruthy();
    });

    it("swallows a Backspace at the start of the document", () => {
      const { onChange } = renderEditor("", { focusOnMount: true });
      const e = new InputEvent("beforeinput", {
        inputType: "deleteContentBackward",
        cancelable: true,
        bubbles: true,
      });
      act(() => {
        surface().dispatchEvent(e);
      });
      expect(e.defaultPrevented).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("survives the blur that dismissing the keyboard brings", () => {
      const { onChange } = renderEditor("", { focusOnMount: true });
      beforeInput("deleteContentBackward");
      // Dropping the active line re-renders the empty note fully formatted —
      // the render that used to throw on a surface the browser had rewritten.
      expect(() => {
        act(() => {
          // A real blur, not a synthetic one: Preact maps `onBlur` onto the
          // bubbling `focusout` (React's semantics) that only `blur()` emits.
          surface().focus();
          surface().blur();
        });
      }).not.toThrow();
      expect(screen.getByText("Start writing…")).toBeTruthy();
      expect(onChange).not.toHaveBeenCalled();
    });

    it("types the first character back into an emptied note", () => {
      const { onChange } = renderEditor("", { focusOnMount: true });
      caretIn(rawLine()!, 0);
      beforeInput("insertText", "a");
      // Capitalised: the first letter of the note opens a sentence.
      expect(onChange).toHaveBeenLastCalledWith("A");
      expect(screen.queryByText("Start writing…")).toBeNull();
    });
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

  // Tapping space twice ends the sentence. The editor intercepts every
  // insertion, which takes the keystroke out of reach of the platform's own
  // version of this shortcut, so it applies the rule itself.
  describe("double space", () => {
    it("ends the sentence on a second space", () => {
      const { onChange } = renderEditor("Hello ");
      caretIn(rawLine()!, 6);
      beforeInput("insertText", " ");
      expect(onChange).toHaveBeenLastCalledWith("Hello. ");
    });

    it("leaves a first space alone", () => {
      const { onChange } = renderEditor("Hello");
      caretIn(rawLine()!, 5);
      beforeInput("insertText", " ");
      expect(onChange).toHaveBeenLastCalledWith("Hello ");
    });

    it("leaves a double space after a full stop alone", () => {
      const { onChange } = renderEditor("Done. ");
      caretIn(rawLine()!, 6);
      beforeInput("insertText", " ");
      expect(onChange).toHaveBeenLastCalledWith("Done.  ");
    });

    it("leaves a code block's spacing verbatim", () => {
      // Code is the exception the platform can't make: inside a fence two
      // spaces are two spaces.
      const { onChange } = renderEditor("```\nlet x = 1 ");
      caretIn(rawLine()!, 11);
      beforeInput("insertText", " ");
      expect(onChange).toHaveBeenLastCalledWith("```\nlet x = 1  ");
    });

    it("stands down when auto correct is turned off", () => {
      const { onChange } = renderEditor("Hello ", { disableAutocorrect: true });
      caretIn(rawLine()!, 6);
      beforeInput("insertText", " ");
      expect(onChange).toHaveBeenLastCalledWith("Hello  ");
    });

    it("types over a selection rather than ending a sentence", () => {
      // The rule is a collapsed-caret affair: with a range selected the space
      // replaces it, exactly as any other character would.
      const { onChange } = renderEditor("Hello there");
      selectRange(rawLine()!, 6, 11);
      beforeInput("insertText", " ");
      expect(onChange).toHaveBeenLastCalledWith("Hello  ");
    });
  });

  // The capital that opens a sentence, for the same reason: intercepting every
  // insertion takes the keystroke out of reach of the keyboard's own
  // auto-capitalisation, so the editor writes the capital itself.
  describe("sentence capitals", () => {
    it("capitalises the first letter after a full stop", () => {
      const { onChange } = renderEditor("Done. ");
      caretIn(rawLine()!, 6);
      beforeInput("insertText", "n");
      expect(onChange).toHaveBeenLastCalledWith("Done. N");
    });

    it("capitalises the first letter of a line", () => {
      const { onChange } = renderEditor("First line\n");
      caretIn(rawLine()!, 0);
      beforeInput("insertText", "s");
      expect(onChange).toHaveBeenLastCalledWith("First line\nS");
    });

    it("leaves a letter mid-sentence alone", () => {
      const { onChange } = renderEditor("Hello ");
      caretIn(rawLine()!, 6);
      beforeInput("insertText", "w");
      expect(onChange).toHaveBeenLastCalledWith("Hello w");
    });

    it("leaves a code block verbatim", () => {
      const { onChange } = renderEditor("```\n");
      caretIn(rawLine()!, 0);
      beforeInput("insertText", "c");
      expect(onChange).toHaveBeenLastCalledWith("```\nc");
    });

    it("capitalises what replaces a selection", () => {
      // What sits after the caret has no say in whether a sentence starts
      // there, so typing over a selection is capitalised like any other letter.
      const { onChange } = renderEditor("hello there");
      selectRange(rawLine()!, 0, 5);
      beforeInput("insertText", "b");
      expect(onChange).toHaveBeenLastCalledWith("B there");
    });

    it("stands down when the setting is off", () => {
      const { onChange } = renderEditor("Done. ", {
        capitaliseSentences: false,
      });
      caretIn(rawLine()!, 6);
      beforeInput("insertText", "n");
      expect(onChange).toHaveBeenLastCalledWith("Done. n");
    });

    it("stands down when auto correct is turned off", () => {
      const { onChange } = renderEditor("Done. ", { disableAutocorrect: true });
      caretIn(rawLine()!, 6);
      beforeInput("insertText", "n");
      expect(onChange).toHaveBeenLastCalledWith("Done. n");
    });
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

  // A phone's autocorrect rewrites the word it just took, handing the editor
  // the word's own range. On the active line that range starts at the line's
  // content start whenever the corrected word is the first one — and the
  // marker-snapping meant for *formatted* lines then widened it over the
  // leading `4. ` / `- ` / `# `, so accepting a correction ate the bullet:
  // "4. Somethign" came back as "Something".
  describe("autocorrect on a marked line", () => {
    it("keeps the ordinal when the first word is corrected", () => {
      const { onChange } = renderEditor("4. Somethign");
      beforeInputOver("insertReplacementText", "Something", rawLine()!, 3, 12);
      expect(onChange).toHaveBeenLastCalledWith("4. Something");
    });

    it("keeps the bullet when the first word is corrected", () => {
      const { onChange } = renderEditor("- Somethign");
      beforeInputOver("insertReplacementText", "Something", rawLine()!, 2, 11);
      expect(onChange).toHaveBeenLastCalledWith("- Something");
    });

    it("keeps the marker when the correction arrives as a selection", () => {
      // Without `getTargetRanges` the editor falls back to the live selection,
      // which the keyboard leaves over the word it is replacing.
      const { onChange } = renderEditor("# Somethign");
      selectRange(rawLine()!, 2, 11);
      beforeInput("insertReplacementText", "Something");
      expect(onChange).toHaveBeenLastCalledWith("# Something");
    });

    it("keeps the marker when a word delete takes the first word", () => {
      const { onChange } = renderEditor("- alpha beta");
      beforeInputOver("deleteWordBackward", null, rawLine()!, 2, 8);
      expect(onChange).toHaveBeenLastCalledWith("- beta");
    });

    it("still takes the marker when the row is selected from its content", () => {
      // The exemption is the raw line's alone: on a formatted line the marker
      // is a glyph the browser can't anchor before, so a selection reaching the
      // content start has taken the whole line, markers included.
      const { onChange } = renderEditor("- alpha\nbeta");
      const formatted = surface().querySelector<HTMLElement>(
        '[data-line-index="0"]',
      )!;
      selectRange(formatted, 0, formatted.textContent!.length);
      beforeInput("insertText", "X");
      expect(onChange).toHaveBeenLastCalledWith("X\nbeta");
    });
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
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });
      // Line 1 is now the active raw line showing its source.
      const raw = rawLine();
      expect(raw?.getAttribute("data-line-index")).toBe("1");
      expect(raw?.textContent).toBe("plain");
      // The other line stays formatted.
      expect(screen.getByText("bold").closest("strong")).not.toBeNull();
    });
  });

  describe("task items", () => {
    // The checkboxes of every rendered task row, in source order.
    function boxes(): HTMLElement[] {
      return screen.queryAllByRole("checkbox");
    }

    it("draws a checkbox per task row, ticked to match the source", () => {
      renderEditor("- [ ] milk\n- [x] bread\n", { focusOnMount: false });
      expect(boxes().map((b) => b.getAttribute("aria-checked"))).toEqual([
        "false",
        "true",
      ]);
      // The box is the marker: the row's text renders without it.
      expect(screen.getByText("milk")).not.toBeNull();
    });

    it("ticks the item off in the source when its box is pressed", () => {
      const { onChange } = renderEditor("- [ ] milk\n- [ ] bread\n", {
        focusOnMount: false,
      });
      fireEvent.click(boxes()[1]!);
      expect(onChange).toHaveBeenCalledWith("- [ ] milk\n- [x] bread\n");
      expect(boxes().map((b) => b.getAttribute("aria-checked"))).toEqual([
        "false",
        "true",
      ]);
    });

    it("unticks a ticked item on a second press", () => {
      const { onChange } = renderEditor("- [x] milk", { focusOnMount: false });
      fireEvent.click(boxes()[0]!);
      expect(onChange).toHaveBeenLastCalledWith("- [ ] milk");
    });

    it("does not open the editor on the line it ticked", () => {
      // The point of the gesture: no raw line, so no caret and no soft
      // keyboard. The press is cancelled on mousedown, before the browser
      // would place a caret with it.
      renderEditor("- [ ] milk\n- [ ] bread\n", { focusOnMount: false });
      const box = boxes()[0]!;
      const down = fireEvent.mouseDown(box);
      expect(down).toBe(false); // preventDefault()ed
      fireEvent.click(box);
      expect(rawLine()).toBeNull();
    });
  });

  describe("styling on the active line", () => {
    it("bolds a run while keeping its asterisks on screen", () => {
      renderEditor("a **b** c");
      const raw = rawLine()!;
      // Verbatim first: the source is what the caret is measured against.
      expect(raw.textContent).toBe("a **b** c");
      const bold = [...raw.querySelectorAll("span")].filter((el) =>
        el.className.includes("font-bold"),
      );
      expect(bold.map((el) => el.textContent)).toEqual(["**", "b", "**"]);
      // The delimiters stay legible — they're what you aim at to remove them.
      expect(bold[0]!.className).toContain("opacity-60");
      expect(bold[1]!.className).not.toContain("opacity-60");
    });

    it("dims a block marker without moving the content after it", () => {
      renderEditor("## Title");
      const raw = rawLine()!;
      expect(raw.textContent).toBe("## Title");
      const marker = raw.querySelector("span")!;
      expect(marker.textContent).toBe("## ");
      expect(marker.className).toContain("opacity-60");
    });

    it("dims a task row's whole box along with its bullet", () => {
      // The `[x]` is part of the block marker, so stepping onto a task row
      // shows `- [x] ` as the markup it is rather than splitting the box off
      // into content.
      renderEditor("- [x] milk");
      const raw = rawLine()!;
      expect(raw.textContent).toBe("- [x] milk");
      const marker = raw.querySelector("span")!;
      expect(marker.textContent).toBe("- [x] ");
      expect(marker.className).toContain("opacity-60");
    });

    it("leaves an unmarked line as one bare text node", () => {
      renderEditor("just prose");
      const line = rawLine()!;
      expect(line.textContent).toBe("just prose");
      expect(line.querySelector("span")).toBeNull();
    });

    it("still splits at the caret's column through the styled runs", () => {
      // The spans must not shift what a DOM offset means in source columns.
      const { onChange } = renderEditor("a **b** c");
      // Column 5 is the end of the `b` run — a different text node from the
      // line's first, which is the whole point.
      caretIn(rawLine()!, 5);
      beforeInput("insertParagraph");
      expect(onChange).toHaveBeenLastCalledWith("a **b\n** c");
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
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });
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
    // Dispatched natively rather than through `fireEvent`: Testing Library's
    // Preact bindings route an event either at the matching `on<name>` DOM
    // property or, failing that, through a fallback that mis-cases the type —
    // and jsdom exposes no `oncompositionstart`, so the fallback is what a
    // `fireEvent.compositionStart` would take.
    function compose(kind: "compositionstart" | "compositionend", data = "") {
      surface().dispatchEvent(
        new CompositionEvent(kind, { bubbles: true, data }),
      );
    }
    function composeInto(line: HTMLElement, text: string) {
      act(() => {
        compose("compositionstart");
      });
      // The browser rewrites the line's children itself — on an empty line that
      // means dropping the lone <br> the renderer put there.
      line.textContent = text;
      act(() => {
        compose("compositionend", text);
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

  // Walking Up / Down keeps aiming at the column the run started from, so a
  // short line in the middle of the note parks the caret at its end without
  // resetting the run. jsdom does no layout, so the browser's half of a
  // vertical move is stood in for: the caret is dropped where a real Down that
  // ran out of characters would leave it, then `selectionchange` is dispatched
  // exactly as the browser would.
  describe("the remembered column", () => {
    const TOP = "abcdefghijklmnopqrst"; // 20 columns
    const BOTTOM = "0123456789abcdefghij"; // 20 columns, the line we open on
    const NOTE = `${TOP}\nbb\n${BOTTOM}`;

    /** The caret's column within the active raw line. */
    function caretColumn(): number {
      const sel = window.getSelection()!;
      const range = document.createRange();
      range.setStart(rawLine()!, 0);
      range.setEnd(sel.anchorNode!, sel.anchorOffset);
      return range.toString().length;
    }

    /** The formatted (non-active) line element showing `text`. */
    function formatted(text: string): HTMLElement {
      return screen.getByText(text).closest("[data-line-index]") as HTMLElement;
    }

    // Drain the microtask the editor re-arms its `selectionchange` handler in
    // after placing a caret itself. Without it the *next* dispatched
    // `selectionchange` is swallowed as one of the editor's own.
    async function settle() {
      await act(async () => {});
    }

    // Put the caret where the browser would, and tell the editor about it.
    async function moveCaret(lineEl: HTMLElement, offset: number) {
      await settle();
      caretIn(lineEl, offset);
      await act(async () => {
        document.dispatchEvent(new Event("selectionchange"));
      });
    }

    /** A vertical key press that lands the caret at `offset` of `lineEl`. */
    async function arrow(
      key: "ArrowUp" | "ArrowDown",
      lineEl: HTMLElement,
      offset: number,
    ) {
      await settle();
      fireEvent.keyDown(surface(), { key });
      await moveCaret(lineEl, offset);
    }

    // Open the note with the caret parked at the end of its bottom line —
    // column 20, the column every run below is aiming for.
    async function openAtColumn20() {
      renderEditor(NOTE);
      await moveCaret(rawLine()!, 20);
    }

    it("comes back to the column a short line could not reach", async () => {
      await openAtColumn20();

      // Up onto the two-character line: the browser can only offer column 2.
      await arrow("ArrowUp", formatted("bb"), 2);
      expect(rawLine()?.getAttribute("data-line-index")).toBe("1");
      expect(caretColumn()).toBe(2);

      // Up again onto a line long enough: column 20 is still what we are after.
      await arrow("ArrowUp", formatted(TOP), 2);
      expect(rawLine()?.getAttribute("data-line-index")).toBe("0");
      expect(caretColumn()).toBe(20);
    });

    it("takes the browser's column when nothing is being aimed at", async () => {
      // The same two moves without the arrow keys: a bare selection change is a
      // caret the user placed, and it is left exactly where it landed.
      await openAtColumn20();

      await moveCaret(formatted("bb"), 2);
      await moveCaret(formatted(TOP), 2);
      expect(rawLine()?.getAttribute("data-line-index")).toBe("0");
      expect(caretColumn()).toBe(2);
    });

    it("forgets the column when the caret is moved sideways", async () => {
      await openAtColumn20();
      await arrow("ArrowUp", formatted("bb"), 2);

      // A horizontal key says the user picked this column deliberately.
      fireEvent.keyDown(surface(), { key: "ArrowRight" });
      await arrow("ArrowUp", formatted(TOP), 2);
      expect(caretColumn()).toBe(2);
    });

    it("aims at the column typing left, not the one before it", async () => {
      await openAtColumn20();
      await arrow("ArrowUp", formatted("bb"), 2);

      // "bb" becomes "bbx" with the caret at column 3, and that is the column
      // the next run walks with — column 20 is history the moment an edit lands.
      beforeInput("insertText", "x");
      await arrow("ArrowUp", formatted(TOP), 2);
      expect(caretColumn()).toBe(3);
    });

    it("forgets the column when a press lands the caret", async () => {
      await openAtColumn20();
      await arrow("ArrowUp", formatted("bb"), 2);

      fireEvent.pointerDown(surface(), { pointerType: "mouse" });
      await arrow("ArrowUp", formatted(TOP), 2);
      expect(caretColumn()).toBe(2);
    });

    it("keeps aiming at the column across a bare modifier press", async () => {
      // Shift goes down before Shift+Down; it must not wipe the run.
      await openAtColumn20();
      await arrow("ArrowUp", formatted("bb"), 2);

      fireEvent.keyDown(surface(), { key: "Shift", shiftKey: true });
      await arrow("ArrowUp", formatted(TOP), 2);
      expect(caretColumn()).toBe(20);
    });

    it("leaves a modified arrow to land where it lands", async () => {
      // Alt+Up jumps to the start of the paragraph rather than stepping onto
      // the next line, so it aims at no remembered column. (Cmd/Ctrl+Up is not
      // this key any more — it grows a column of carets; see "multiple
      // cursors" below.)
      await openAtColumn20();

      fireEvent.keyDown(surface(), { key: "ArrowUp", altKey: true });
      await moveCaret(formatted("bb"), 2);
      await arrow("ArrowUp", formatted(TOP), 2);
      expect(caretColumn()).toBe(2);
    });

    // A soft-wrapped line is many rows tall, and a column only means anything
    // relative to the row it is counted from. jsdom lays nothing out, so
    // wrapping is simulated the same way `visualRowAt`'s own tests do it: every
    // measured range reports the row its first character falls in, at
    // `PER_ROW` characters per row.
    describe("on a soft-wrapped line", () => {
      const PER_ROW = 10;
      const realGetClientRects = Range.prototype.getClientRects;

      function wrapAt10Characters() {
        Range.prototype.getClientRects = function (this: Range) {
          const line = lineElementOf(this.startContainer);
          const column = line
            ? columnOf(line, this.startContainer, this.startOffset)
            : 0;
          return [
            { top: Math.floor(column / PER_ROW) * 20, height: 20 },
          ] as unknown as DOMRectList;
        };
      }

      /** The `[data-line-index]` element a node sits in. */
      function lineElementOf(node: Node): HTMLElement | null {
        const el =
          node.nodeType === Node.TEXT_NODE
            ? node.parentElement
            : (node as Element);
        return el?.closest("[data-line-index]") as HTMLElement | null;
      }

      /** The column a (node, offset) sits at within `line`. */
      function columnOf(line: HTMLElement, node: Node, offset: number): number {
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let column = 0;
        let text = walker.nextNode() as Text | null;
        while (text) {
          if (text === node) return column + offset;
          column += text.data.length;
          text = walker.nextNode() as Text | null;
        }
        return column + offset;
      }

      afterEach(() => {
        Range.prototype.getClientRects = realGetClientRects;
      });

      // Four rows of ten: 0-9, 10-19, 20-29, 30-34.
      const PARAGRAPH = "p".repeat(35);

      /** The line element for source line `index`, formatted or raw. */
      function lineEl(index: number): HTMLElement {
        return surface().querySelector(
          `[data-line-index="${index}"]`,
        ) as HTMLElement;
      }

      it("arrives on the last row when walking up into it", async () => {
        // The bug this describes: the caret used to land at column 4 of the
        // paragraph — its *first* row — while the eye expects the row the caret
        // came in through, the last one.
        renderEditor(`${PARAGRAPH}\ntail`);
        wrapAt10Characters();
        await moveCaret(rawLine()!, 4);

        await arrow("ArrowUp", lineEl(0), 0);
        expect(rawLine()?.getAttribute("data-line-index")).toBe("0");
        // Row 3 starts at column 30, so four columns into it is 34.
        expect(caretColumn()).toBe(34);
      });

      it("arrives on the first row when walking down into it", async () => {
        renderEditor(`head\n${PARAGRAPH}`);
        wrapAt10Characters();
        await moveCaret(lineEl(0), 4);

        await arrow("ArrowDown", lineEl(1), 0);
        expect(rawLine()?.getAttribute("data-line-index")).toBe("1");
        expect(caretColumn()).toBe(4);
      });

      it("aims at the column within the row the run started on", async () => {
        // Leaving a wrapped line takes the column counted from the row the
        // caret sits in, not the source column — which on row 3 is 34, and
        // would run off the end of every short line after it.
        renderEditor(`${PARAGRAPH}\ntail`);
        wrapAt10Characters();
        await moveCaret(lineEl(0), 34);

        await arrow("ArrowDown", lineEl(1), 0);
        expect(rawLine()?.getAttribute("data-line-index")).toBe("1");
        expect(caretColumn()).toBe(4);
      });

      it("parks at the end of a row too short to reach the column", async () => {
        // Row 3 holds only five characters, so a column-8 run settles at its
        // end rather than spilling past the line.
        renderEditor(`${PARAGRAPH}\nlonger tail`);
        wrapAt10Characters();
        await moveCaret(rawLine()!, 8);

        await arrow("ArrowUp", lineEl(0), 0);
        expect(caretColumn()).toBe(35);
      });
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

    it("indents a list row instead of tabbing out", () => {
      const onTabOut = vi.fn();
      const { onChange } = renderEditor("- one", { onTabOut });
      caretIn(rawLine()!, 4);

      fireEvent.keyDown(surface(), { key: "Tab" });
      expect(onChange).toHaveBeenLastCalledWith("  - one");
      expect(onTabOut).not.toHaveBeenCalled();

      caretIn(rawLine()!, 6);
      fireEvent.keyDown(surface(), { key: "Tab", shiftKey: true });
      expect(onChange).toHaveBeenLastCalledWith("- one");
      expect(onTabOut).not.toHaveBeenCalled();
    });

    it("tabs out of a list row that has nothing left to unindent", () => {
      // Otherwise the outer level of a list would trap the keyboard.
      const onTabOut = vi.fn();
      renderEditor("- one", { onTabOut });
      caretIn(rawLine()!, 4);

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

  // --- Multiple cursors -----------------------------------------------------
  //
  // The VS Code column: Ctrl/Cmd+D takes the word under the caret and then each
  // occurrence of it after that; Ctrl/Cmd+Up / Down grow a plain column; every
  // edit lands at all of them; Escape drops back to the one you started from.
  //
  // A line a cursor sits on renders raw, so counting `[data-raw]` elements is
  // how many carets the editor is holding — jsdom lays nothing out, so the
  // painted overlay itself measures to nothing and can't be asserted on.
  describe("multiple cursors", () => {
    function rawLines(): HTMLElement[] {
      return [...surface().querySelectorAll<HTMLElement>("[data-raw]")];
    }
    function press(key: string, extra: Record<string, unknown> = {}) {
      act(() => {
        fireEvent.keyDown(surface(), { key, ...extra });
      });
    }
    function selectedText(): string {
      return window.getSelection()?.toString() ?? "";
    }

    it("takes the word under the caret on the first Ctrl/Cmd+D", () => {
      renderEditor("alpha beta");
      caretIn(rawLine()!, 7);
      press("d", { metaKey: true });
      expect(selectedText()).toBe("beta");
      // Selecting a word is not yet a column.
      expect(rawLines()).toHaveLength(1);
    });

    it("adds a caret over the next occurrence on the second press", () => {
      const { onChange } = renderEditor("one\ntwo\none");
      caretIn(surface().querySelector('[data-line-index="0"]')!, 1);
      press("d", { metaKey: true });
      press("d", { metaKey: true });
      // Both `one` lines are now being edited.
      expect(
        rawLines()
          .map((el) => el.dataset.lineIndex)
          .sort(),
      ).toEqual(["0", "2"]);
      beforeInput("insertText", "X");
      expect(onChange).toHaveBeenLastCalledWith("X\ntwo\nX");
    });

    it("skips an occurrence inside a longer word", () => {
      const { onChange } = renderEditor("id\nwidth\nid");
      caretIn(surface().querySelector('[data-line-index="0"]')!, 1);
      press("d", { metaKey: true });
      press("d", { metaKey: true });
      beforeInput("insertText", "K");
      expect(onChange).toHaveBeenLastCalledWith("K\nwidth\nK");
    });

    it("grows a column of bare carets with Ctrl/Cmd+Down", () => {
      const { onChange } = renderEditor("aa\nbb\ncc");
      caretIn(surface().querySelector('[data-line-index="0"]')!, 0);
      press("ArrowDown", { metaKey: true });
      press("ArrowDown", { metaKey: true });
      expect(rawLines()).toHaveLength(3);
      // Bare carets, so nothing is selected and nothing is replaced.
      beforeInput("insertText", "-");
      expect(onChange).toHaveBeenLastCalledWith("-aa\n-bb\n-cc");
    });

    it("also answers VS Code's own Ctrl/Cmd+Alt+Down", () => {
      renderEditor("aa\nbb");
      caretIn(surface().querySelector('[data-line-index="0"]')!, 0);
      press("ArrowDown", { metaKey: true, altKey: true });
      expect(rawLines()).toHaveLength(2);
    });

    it("stops at the note's edge", () => {
      renderEditor("aa\nbb");
      caretIn(surface().querySelector('[data-line-index="0"]')!, 0);
      press("ArrowUp", { metaKey: true });
      expect(rawLines()).toHaveLength(1);
    });

    it("deletes at every caret", () => {
      const { onChange } = renderEditor("aXb\ncXd");
      caretIn(surface().querySelector('[data-line-index="0"]')!, 2);
      press("ArrowDown", { metaKey: true });
      beforeInput("deleteContentBackward");
      expect(onChange).toHaveBeenLastCalledWith("ab\ncd");
    });

    it("splits at every caret on Enter", () => {
      const { onChange } = renderEditor("ab\ncd");
      caretIn(surface().querySelector('[data-line-index="0"]')!, 1);
      press("ArrowDown", { metaKey: true });
      beforeInput("insertParagraph");
      expect(onChange).toHaveBeenLastCalledWith("a\nb\nc\nd");
    });

    it("walks every caret with an arrow key", () => {
      const { onChange } = renderEditor("abc\ndef");
      caretIn(surface().querySelector('[data-line-index="0"]')!, 1);
      press("ArrowDown", { metaKey: true });
      press("ArrowRight");
      beforeInput("insertText", ".");
      expect(onChange).toHaveBeenLastCalledWith("ab.c\nde.f");
    });

    it("drops back to the caret it started from on Escape", () => {
      const { onChange } = renderEditor("aa\nbb");
      caretIn(surface().querySelector('[data-line-index="0"]')!, 0);
      press("ArrowDown", { metaKey: true });
      expect(rawLines()).toHaveLength(2);
      press("Escape");
      expect(rawLines()).toHaveLength(1);
      beforeInput("insertText", "!");
      expect(onChange).toHaveBeenLastCalledWith("!aa\nbb");
    });

    it("ends the column when the note is pressed", () => {
      renderEditor("aa\nbb");
      caretIn(surface().querySelector('[data-line-index="0"]')!, 0);
      press("ArrowDown", { metaKey: true });
      act(() => {
        fireEvent.pointerDown(surface().parentElement!, {
          pointerType: "mouse",
        });
      });
      expect(rawLines()).toHaveLength(1);
    });

    it("refuses to multiply anything in a locked note", () => {
      renderEditor("one one", { locked: true });
      press("d", { metaKey: true });
      expect(rawLines()).toHaveLength(0);
    });

    it("deletes forwards at every caret too", () => {
      const { onChange } = renderEditor("aXb\ncXd");
      caretIn(surface().querySelector('[data-line-index="0"]')!, 1);
      press("ArrowDown", { metaKey: true });
      beforeInput("deleteContentForward");
      expect(onChange).toHaveBeenLastCalledWith("ab\ncd");
    });

    it("deletes the word behind every caret", () => {
      const { onChange } = renderEditor("one two\nsix four");
      caretIn(surface().querySelector('[data-line-index="0"]')!, 4);
      press("ArrowDown", { metaKey: true });
      beforeInput("deleteWordBackward");
      expect(onChange).toHaveBeenLastCalledWith("two\nfour");
    });

    // The clipboard at N carets, which is where a column stops being a party
    // trick: copy takes what each cursor holds, cut takes it away, and a paste
    // of what a column copied is dealt back out one piece per caret.
    describe("the clipboard", () => {
      // jsdom's clipboard events carry no `clipboardData`, so the editor is
      // handed one that records what it was given — which is the assertion.
      function clipboard(initial = "") {
        const held: Record<string, string> = { "text/plain": initial };
        return {
          setData: (type: string, value: string) => {
            held[type] = value;
          },
          getData: (type: string) => held[type] ?? "",
          get text() {
            return held["text/plain"] ?? "";
          },
          types: ["text/plain"],
          files: [],
          items: [],
        };
      }

      // Copy and cut are listened for on the document (they arrive there
      // whatever inside the surface is focused), so that is where they go.
      function clip(type: "copy" | "cut", data: ReturnType<typeof clipboard>) {
        const e = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(e, "clipboardData", { value: data });
        act(() => {
          document.dispatchEvent(e);
        });
        return e;
      }

      function paste(text: string) {
        act(() => {
          fireEvent.paste(surface(), { clipboardData: clipboard(text) });
        });
      }

      // Two carets over the two `one`s, each holding the word.
      function twoSelections(body = "one\ntwo\none") {
        const rendered = renderEditor(body);
        caretIn(surface().querySelector('[data-line-index="0"]')!, 1);
        press("d", { metaKey: true });
        press("d", { metaKey: true });
        return rendered;
      }

      // A bare column down the note, nothing selected.
      function twoCarets(body: string, col = 0) {
        const rendered = renderEditor(body);
        caretIn(surface().querySelector('[data-line-index="0"]')!, col);
        press("ArrowDown", { metaKey: true });
        return rendered;
      }

      it("copies each selection, one per line", () => {
        twoSelections();
        const data = clipboard();
        const e = clip("copy", data);
        expect(data.text).toBe("one\none");
        // Taken from the browser: what it would have copied is one selection.
        expect(e.defaultPrevented).toBe(true);
      });

      it("cuts every selection, leaving a caret where each was", () => {
        const { onChange } = twoSelections();
        const data = clipboard();
        clip("cut", data);
        expect(data.text).toBe("one\none");
        expect(onChange).toHaveBeenLastCalledWith("\ntwo\n");
        expect(rawLines()).toHaveLength(2);
      });

      it("copies the whole line each bare caret sits on", () => {
        twoCarets("aa\nbb\ncc");
        const data = clipboard();
        clip("copy", data);
        // Newline-terminated, so pasting them back makes lines again.
        expect(data.text).toBe("aa\nbb\n");
      });

      it("cuts those whole lines, riding each caret onto what moved up", () => {
        const { onChange } = twoCarets("aa\nbb\ncc\ndd");
        const data = clipboard();
        clip("cut", data);
        expect(data.text).toBe("aa\nbb\n");
        expect(onChange).toHaveBeenLastCalledWith("cc\ndd");
        // Both carets rode down onto the same spot — the head of the line that
        // moved up — and two carets at one spot are one caret.
        expect(rawLines()).toHaveLength(1);
      });

      it("deals a clipboard of one line per caret out a line each", () => {
        const { onChange } = twoCarets("aa\nbb", 1);
        paste("X\nY");
        expect(onChange).toHaveBeenLastCalledWith("aXa\nbYb");
      });

      it("deals whole lines out too, a line to each caret", () => {
        const { onChange } = twoCarets("aa\nbb");
        // What a bare column copies: two whole lines, newline-terminated.
        paste("X\nY\n");
        expect(onChange).toHaveBeenLastCalledWith("X\naa\nY\nbb");
      });

      it("round-trips a bare column through cut and paste", () => {
        const { onChange } = twoCarets("aa\nbb\ncc");
        const data = clipboard();
        clip("cut", data);
        expect(onChange).toHaveBeenLastCalledWith("cc");
        // One line left, so the column is one caret now — the lines go in
        // whole at it rather than being dealt out.
        paste(data.text);
        expect(onChange).toHaveBeenLastCalledWith("aa\nbb\ncc");
      });

      it("pastes over what each cursor has selected", () => {
        const { onChange } = twoSelections();
        paste("Z");
        expect(onChange).toHaveBeenLastCalledWith("Z\ntwo\nZ");
      });

      it("pastes anything else in whole at every caret", () => {
        const { onChange } = twoCarets("aa\nbb", 1);
        paste("ZZ");
        expect(onChange).toHaveBeenLastCalledWith("aZZa\nbZZb");
      });

      it("leaves the clipboard to the browser with a single caret", () => {
        renderEditor("one\ntwo");
        caretIn(rawLine()!, 1);
        const e = clip("copy", clipboard());
        expect(e.defaultPrevented).toBe(false);
      });
    });
  });

  // Every edit is refused at `beforeinput` whether or not it can be mapped —
  // letting one through has the browser rewrite the DOM React owns. Refusing
  // *and* silently dropping it, though, is a dead keyboard: the user types and
  // nothing happens at all, with no crash to explain it.
  describe("an edit whose position can't be resolved", () => {
    it("lands an insertion at the last known caret instead of dropping it", () => {
      const { onChange } = renderEditor("hello");
      caretIn(rawLine()!, 5);
      beforeInput("insertText", "!");
      expect(onChange).toHaveBeenLastCalledWith("hello!");
      // The browser proposes another keystroke, but nothing anchors it: no
      // target range and no selection to fall back on.
      window.getSelection()?.removeAllRanges();
      beforeInput("insertText", "?");
      expect(onChange).toHaveBeenLastCalledWith("hello!?");
    });

    it("still refuses a deletion rather than guessing at a span", () => {
      const { onChange } = renderEditor("hello");
      caretIn(rawLine()!, 5);
      beforeInput("insertText", "!");
      onChange.mockClear();
      window.getSelection()?.removeAllRanges();
      beforeInput("deleteContentBackward");
      // Guessing here would remove text the browser never pointed at.
      expect(onChange).not.toHaveBeenCalled();
    });

    it("drops an insertion when the caret has never been placed", () => {
      const { onChange } = renderEditor("hello", { focusOnMount: false });
      window.getSelection()?.removeAllRanges();
      beforeInput("insertText", "?");
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  // The editing host holds nothing but lines. A `contenteditable={false}`
  // island inside it is a node the browser normalises around and React later
  // removes, which surfaces as a `removeChild` NotFoundError that unmounts the
  // app — the crash the empty-note prompt was moved out for.
  it("draws the collected attachments block outside the editing host", () => {
    const { container } = renderEditor("![img](attachments/a.png)", {
      canAttach: true,
      placement: { imagesAtEnd: true, filesAtEnd: true },
      attachments: [{ filename: "a.png", mime: "image/png" }],
    });
    const block = screen.getByText("Attachments").closest("div")!;
    expect(surface().contains(block)).toBe(false);
    expect(container.contains(block)).toBe(true);
    // Nothing non-editable is left parked at the end of the document.
    expect(surface().querySelector("[contenteditable=false]")).toBeNull();
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
          { line: 0, from: 0, endLine: 0, to: 5 },
          { line: 1, from: 6, endLine: 1, to: 11 },
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
        matches: [{ line: 0, from: 6, endLine: 0, to: 10 }],
        activeMatch: 0,
      });
      // The mark and the text before it are siblings, each carrying the column
      // it starts at — a caret / selection inside either maps back correctly.
      const mark = surface().querySelector("mark")!;
      expect(mark.getAttribute("data-src")).toBe("6");
      expect(mark.previousElementSibling?.getAttribute("data-src")).toBe("0");
    });

    it("paints a hit that spans a line break on every line it covers", () => {
      renderEditor("alpha beta\ngamma alpha", {
        focusOnMount: false,
        // "beta\ngamma" — one hit, ending on the line below the one it starts
        // on, so the highlight has to be cut into a piece per line.
        matches: [{ line: 0, from: 6, endLine: 1, to: 5 }],
        activeMatch: 0,
      });
      const marks = surface().querySelectorAll("mark");
      expect([...marks].map((m) => m.textContent)).toEqual(["beta", "gamma"]);
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

    // How much room the surface reserves for the gutter, in `ch` — the digit
    // term of its `calc()` left padding. Read off the coefficient rather than
    // the whole string because jsdom folds `2 * 0.75ch` down to `1.5ch` and
    // reorders the sum, neither of which the feature depends on.
    function gutterCh(): number {
      const m = /(?:([\d.]+)\s*\*\s*)?([\d.]+)ch/.exec(
        surface().style.paddingLeft,
      );
      return m ? Number(m[1] ?? 1) * Number(m[2]!) : 0;
    }

    function renderLines(count: number, extra?: Record<string, unknown>) {
      return renderEditor(
        Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n"),
        { focusOnMount: false, ...extra },
      );
    }

    it("reserves gutter room for the note's digit count, not a fixed width", () => {
      // A nine-line note spends one digit's width on the gutter; the tenth line
      // is what widens it to two, and nothing else ever does.
      const two = renderLines(2, { lineNumbers: true });
      expect(gutterCh()).toBeCloseTo(0.75);
      two.unmount();
      const nine = renderLines(9, { lineNumbers: true });
      expect(gutterCh()).toBeCloseTo(0.75);
      nine.unmount();
      const ten = renderLines(10, { lineNumbers: true });
      expect(gutterCh()).toBeCloseTo(1.5);
      ten.unmount();
      renderLines(100, { lineNumbers: true });
      expect(gutterCh()).toBeCloseTo(2.25);
    });

    it("reserves nothing while the setting is off", () => {
      renderLines(10);
      // The plain `px-4` class alone — no inline override widening the column.
      expect(surface().style.paddingLeft).toBe("");
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

    it("asks the host for select mode when a number is pressed", () => {
      // The gutter is the shorthand way into select mode: pressing a number
      // turns the mode on with that line taken, rather than drawing a browser
      // selection of its own. What the taken line then looks like, and how a
      // drag down the gutter takes a run, is `markdown-editor-select-mode`.
      const onSelectModeChange = vi.fn();
      renderEditor("alpha\nbeta", {
        focusOnMount: false,
        lineNumbers: true,
        onSelectModeChange,
      });
      act(() => {
        // A whole press and lift: a touch on the gutter waits until the stroke
        // has proved it isn't the swipe that opens the side menu, which starts
        // on the same strip of screen (see `markdown-editor-select-mode`).
        fireEvent.pointerDown(gutter()[0]!, { pointerId: 1, bubbles: true });
        fireEvent.pointerUp(gutter()[0]!, { pointerId: 1, bubbles: true });
      });
      expect(onSelectModeChange).toHaveBeenCalledWith(true);
      // No browser selection: the mode paints the lines itself, and a range
      // here would raise the platform's own callout over them.
      expect(window.getSelection()!.toString()).toBe("");
    });

    it("lands no caret and takes no scroll from the gutter", () => {
      // The gutter is purely a selection area. Cancelling `mousedown` is what
      // keeps the caret — and with it the soft keyboard — off the note, and
      // `touch-none` is what stops a finger scrolling with it, so a stroke
      // starting here is always a selection.
      renderEditor("alpha\nbeta", { focusOnMount: false, lineNumbers: true });
      const button = gutter()[0]!;
      expect(button.className).toContain("touch-none");
      const down = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        button.dispatchEvent(down);
      });
      expect(down.defaultPrevented).toBe(true);
      expect(document.activeElement).not.toBe(surface());
    });

    it("keeps the digits a gutter gap clear of the text while the target spans the column", () => {
      // The press target is the whole gutter column — the row's full height,
      // out to the surface's left inset — so a fingertip aimed left of the
      // line hits it. Its right padding is what holds the digits themselves
      // `GUTTER_GAP` off the first character.
      renderEditor("alpha", { focusOnMount: false, lineNumbers: true });
      const button = gutter()[0]!;
      expect(button.style.paddingRight).toBe("1rem");
      expect(button.className).toContain("inset-y-0");
      // Top-aligned: the digit rides in a one-row-tall box beside the line's
      // *first* wrapped row, rather than centring over the whole line.
      expect(button.className).toContain("items-start");
      expect(button.querySelector("span")?.className).toContain("h-[1lh]");
    });
  });
});

// A locked note is read-only: the surface takes no caret (so no soft keyboard
// comes up and nothing blinks on a desktop) and refuses every edit — while
// reading, selecting and the line-number gutter carry on untouched.
// A selection outliving the focus that drew it — what dismissing the soft
// keyboard leaves behind on a phone.
describe("MarkdownEditor (selection on blur)", () => {
  // Focus leaves the surface while a selection is still standing in it — what
  // dismissing the soft keyboard does on a phone, and the state the drop is
  // about.
  //
  // Assembled by hand, because jsdom won't produce it: its `blur()` clears the
  // selection outright, and focusing anything else collapses the selection
  // into *that* element — neither of which a browser does. So blur for real to
  // get `activeElement` off the surface, put the selection back where a
  // browser would have left it, and re-deliver the `focusout` that Preact maps
  // `onBlur` onto. Awaited because the handler defers to a microtask.
  async function dismissKeyboard(lineIndex: number, text: string) {
    await act(async () => {
      surface().blur();
    });
    selectRange(
      surface().querySelector<HTMLElement>(`[data-line-index='${lineIndex}']`)!,
      0,
      text.length,
    );
    await act(async () => {
      surface().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
  }

  it("drops the line's selection when focus leaves the surface", async () => {
    // Dismissing the keyboard blurs the surface and takes the highlight with
    // it, but the DOM range used to survive: the next tap on those lines then
    // handed the browser a selection to act on — it repainted the row and
    // raised the Cut / Copy / Paste bar — so it took a second tap to get a
    // caret back into a line that looked idle.
    renderEditor("alpha\nbeta", { focusOnMount: false });
    selectRange(screen.getByText("alpha"), 0, 5);
    expect(window.getSelection()!.toString()).toBe("alpha");

    await dismissKeyboard(0, "alpha");

    expect(window.getSelection()!.rangeCount).toBe(0);
  });

  it("leaves the selection standing for a desktop pointer", async () => {
    // A mouse has no soft keyboard to dismiss, and the browser keeps painting
    // the selection (greyed) once focus moves on — so nothing goes invisible
    // and the platform's own behaviour stands.
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        media: "",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn(),
      })),
    );
    try {
      renderEditor("alpha\nbeta", { focusOnMount: false });
      selectRange(screen.getByText("alpha"), 0, 5);

      await dismissKeyboard(0, "alpha");

      expect(window.getSelection()!.toString()).toBe("alpha");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("MarkdownEditor (locked)", () => {
  function gutter(): HTMLElement[] {
    return [
      ...surface().querySelectorAll<HTMLElement>(
        "button[aria-label^='Select line']",
      ),
    ];
  }

  it("is not editable, and says so to a screen reader", () => {
    renderEditor("hello", { locked: true });
    expect(surface().getAttribute("contenteditable")).toBe("false");
    expect(surface().getAttribute("aria-readonly")).toBe("true");
  });

  it("opens with no raw line even where an unlocked note would have one", () => {
    // `focusOnMount` asks for the caret at the end of the note; locked, there
    // is nowhere to put it, so every line renders formatted.
    renderEditor("# heading", { locked: true, focusOnMount: true });
    expect(rawLine()).toBeNull();
    // Formatted, not raw: the `#` is gone and the text sits outside any raw line.
    expect(screen.getByText("heading").closest("[data-raw]")).toBeNull();
  });

  it("refuses an edit that reaches the surface anyway", () => {
    // The attribute alone should keep `beforeinput` from ever firing; this is
    // the second lock, for an edit that got past it.
    const { onChange } = renderEditor("hello", { locked: true });
    beforeInput("insertText", "x");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("takes the raw line back to formatted when the note is locked mid-edit", () => {
    const { rerender } = render(
      <MarkdownEditor body="# heading" onChange={vi.fn()} {...editorProps} />,
    );
    expect(rawLine()?.textContent).toBe("# heading");
    act(() => {
      rerender(
        <MarkdownEditor
          body="# heading"
          onChange={vi.fn()}
          {...editorProps}
          locked
        />,
      );
    });
    expect(rawLine()).toBeNull();
    // Formatted, not raw: the `#` is gone and the text sits outside any raw line.
    expect(screen.getByText("heading").closest("[data-raw]")).toBeNull();
  });

  it("still opens select mode from the gutter", () => {
    // The whole point of leaving the gutter working on a locked note: picking
    // lines is how you copy them, and select mode is what a gutter press asks
    // for. It is a read of the note, so the lock has nothing to refuse.
    const onSelectModeChange = vi.fn();
    renderEditor("alpha\nbeta", {
      locked: true,
      lineNumbers: true,
      onSelectModeChange,
    });
    act(() => {
      fireEvent.pointerDown(gutter()[0]!, { pointerId: 1, bubbles: true });
      fireEvent.pointerUp(gutter()[0]!, { pointerId: 1, bubbles: true });
    });
    expect(onSelectModeChange).toHaveBeenCalledWith(true);
  });

  it("hands out the taken line's verbatim source, so it can be copied", () => {
    // Press a line number on a locked note and the header's copy button takes
    // the Markdown you typed, `**` and all, not the rendered text.
    const handle: { current: MarkdownEditorHandle | null } = { current: null };
    renderEditor("**bold** tail\nsecond", {
      locked: true,
      lineNumbers: true,
      selectMode: true,
      handleRef: handle,
    });
    act(() => {
      fireEvent.pointerDown(gutter()[0]!, { pointerId: 1, bubbles: true });
      fireEvent.pointerUp(gutter()[0]!, { pointerId: 1, bubbles: true });
    });
    expect(handle.current?.selection()).toBe("**bold** tail");
  });

  it("leaves a task checkbox showing state rather than taking a press", () => {
    const { onChange } = renderEditor("- [ ] milk", { locked: true });
    const box = surface().querySelector("[data-task-toggle]");
    expect(box).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

// The editor tells its host when a selection appears and disappears, which is
// what puts the selection actions in the narrow editor header (see the
// selection actions in `NoteEditor.tsx`).
describe("MarkdownEditor (selection reporting)", () => {
  function selChange() {
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });
  }

  it("reports a selection appearing and collapsing, once each", () => {
    const onSelectionChange = vi.fn();
    renderEditor("hello world", { focusOnMount: false, onSelectionChange });

    selectRange(screen.getByText("hello world"), 0, 5);
    selChange();
    expect(onSelectionChange.mock.calls).toEqual([[true]]);

    // A caret move inside the same state says nothing new — the host is only
    // told when the answer changes.
    selChange();
    expect(onSelectionChange.mock.calls).toEqual([[true]]);

    caretIn(rawLine() ?? screen.getByText("hello world"), 2);
    selChange();
    expect(onSelectionChange.mock.calls).toEqual([[true], [false]]);
  });

  it("takes its report with it when the editor goes away", () => {
    const onSelectionChange = vi.fn();
    const { unmount } = renderEditor("hello world", {
      focusOnMount: false,
      onSelectionChange,
    });

    selectRange(screen.getByText("hello world"), 0, 5);
    selChange();
    expect(onSelectionChange).toHaveBeenLastCalledWith(true);

    unmount();
    expect(onSelectionChange).toHaveBeenLastCalledWith(false);
  });

  it("hands out the verbatim source the selection covers", () => {
    const handle: { current: MarkdownEditorHandle | null } = { current: null };
    renderEditor("# heading\n**bold** tail", {
      focusOnMount: false,
      handleRef: handle,
    });

    // Drawn over the rendered line — which shows neither the `#` nor the `**`
    // — the handle still answers with the source that was typed.
    const first = surface().querySelector<HTMLElement>(
      '[data-line-index="0"]',
    )!;
    const last = surface().querySelector<HTMLElement>('[data-line-index="1"]')!;
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(last, last.childNodes.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    expect(handle.current?.selection()).toBe("# heading\n**bold** tail");

    sel.removeAllRanges();
    expect(handle.current?.selection()).toBe(null);
  });

  // The second half of the report: whether what is selected is *whole lines*,
  // which is what puts the line-move chevrons in the header (see
  // `docs/overview.md#move-lines`).
  it("calls a whole-line selection whole, and a part-line one not", () => {
    const onWholeLineSelection = vi.fn();
    renderEditor("alpha\nbeta", {
      focusOnMount: false,
      onWholeLineSelection,
    });

    const first = surface().querySelector<HTMLElement>(
      '[data-line-index="0"]',
    )!;
    const last = surface().querySelector<HTMLElement>('[data-line-index="1"]')!;
    const sel = window.getSelection()!;
    const whole = document.createRange();
    whole.setStart(first, 0);
    whole.setEnd(last, last.childNodes.length);
    sel.removeAllRanges();
    sel.addRange(whole);
    selChange();
    expect(onWholeLineSelection).toHaveBeenLastCalledWith(true);

    // A line and a bite of the next: the highlight never named the rest of that
    // second line, so moving it whole is not on offer.
    selectRange(screen.getByText("alpha"), 0, 5);
    const part = document.createRange();
    part.setStart(first, 0);
    part.setEnd(domPointIn(last, 2).node, domPointIn(last, 2).offset);
    sel.removeAllRanges();
    sel.addRange(part);
    selChange();
    expect(onWholeLineSelection).toHaveBeenLastCalledWith(false);
    // The selection itself is still very much there.
    expect(sel.isCollapsed).toBe(false);
  });
});

// Alt+↑ / Alt+↓, the shortcut every code editor binds: the selected lines (or,
// with nothing selected, the line the caret is on) shuffle one row up or down.
describe("MarkdownEditor (moving lines)", () => {
  function altArrow(key: "ArrowUp" | "ArrowDown") {
    act(() => {
      fireEvent.keyDown(surface(), { key, altKey: true });
    });
  }

  it("moves the caret's line down and takes the caret with it", () => {
    const { onChange } = renderEditor("one\ntwo\nthree", {
      focusOnMount: false,
    });
    caretIn(screen.getByText("two"), 1);
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });

    altArrow("ArrowDown");

    expect(onChange).toHaveBeenLastCalledWith("one\nthree\ntwo");
    // The caret rode along, so a second press carries on from the same line.
    expect(rawLine()?.textContent).toBe("two");
  });

  it("moves a whole-line selection as a block", () => {
    const { onChange } = renderEditor("one\ntwo\nthree", {
      focusOnMount: false,
    });
    const first = surface().querySelector<HTMLElement>(
      '[data-line-index="1"]',
    )!;
    const last = surface().querySelector<HTMLElement>('[data-line-index="2"]')!;
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(last, last.childNodes.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    altArrow("ArrowUp");

    expect(onChange).toHaveBeenLastCalledWith("two\nthree\none");
  });

  it("leaves the note alone at the edge it is travelling towards", () => {
    const { onChange } = renderEditor("one\ntwo", { focusOnMount: false });
    caretIn(screen.getByText("one"), 0);
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });

    altArrow("ArrowUp");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("refuses the edit on a locked note", () => {
    const { onChange } = renderEditor("one\ntwo", {
      focusOnMount: false,
      locked: true,
    });

    altArrow("ArrowDown");

    expect(onChange).not.toHaveBeenCalled();
  });
});

// The Insert menu's Image/file row leaves the app for the device's file
// browser, which blurs the surface — and on a phone takes the soft keyboard,
// and with it the caret, down too. The caret is the only thing on screen
// saying where the attachment is about to land, so it is held for the trip.
describe("MarkdownEditor (holding the caret across a trip out)", () => {
  function leaveSurface() {
    act(() => {
      surface().focus();
      surface().blur();
    });
  }

  async function settle() {
    // The blur verdict is deferred to a microtask (a cross-line edit fires a
    // transient blur it has to ignore).
    await act(async () => {
      await Promise.resolve();
    });
  }

  function editorWithHandle() {
    const handle: { current: MarkdownEditorHandle | null } = { current: null };
    renderEditor("alpha\nbeta", { handleRef: handle });
    return handle;
  }

  it("folds the active line away on an ordinary blur", async () => {
    editorWithHandle();
    expect(rawLine()).not.toBeNull();
    leaveSurface();
    await settle();
    expect(rawLine()).toBeNull();
  });

  it("keeps the active line while the caret is held", async () => {
    const handle = editorWithHandle();
    act(() => handle.current!.holdCaret(true));
    leaveSurface();
    await settle();
    expect(rawLine()).not.toBeNull();
  });

  it("puts the caret back when the hold is released", async () => {
    const handle = editorWithHandle();
    act(() => handle.current!.holdCaret(true));
    leaveSurface();
    await settle();
    act(() => handle.current!.holdCaret(false));
    expect(rawLine()).not.toBeNull();
    expect(surface().contains(document.activeElement)).toBe(true);
  });

  it("folds away again on the next real blur once released", async () => {
    const handle = editorWithHandle();
    act(() => handle.current!.holdCaret(true));
    leaveSurface();
    await settle();
    act(() => handle.current!.holdCaret(false));
    leaveSurface();
    await settle();
    expect(rawLine()).toBeNull();
  });
});
