// @vitest-environment jsdom
import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "../../src/ui/MarkdownEditor.tsx";

function renderEditor(body: string) {
  const onChange = vi.fn();
  const utils = render(
    <MarkdownEditor
      body={body}
      onChange={onChange}
      wordWrap
      disableSpellcheck={false}
      disableAutocorrect={false}
      maxWidth="none"
    />,
  );
  return { onChange, ...utils };
}

const editorProps = {
  wordWrap: true,
  disableSpellcheck: false,
  disableAutocorrect: false,
  maxWidth: "none",
} as const;

// The active line is the one the caret sits on; it's the only <textarea>.
function activeTextarea(): HTMLTextAreaElement {
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

function caretAt(ta: HTMLTextAreaElement, pos: number) {
  ta.setSelectionRange(pos, pos);
}

describe("MarkdownEditor", () => {
  it("renders every non-active line as formatted Markdown", () => {
    // Two lines; the caret opens on the last, so the first renders formatted.
    renderEditor("**bold**\nplain");
    // The leaf text sits in a source-stamped span inside the <strong>.
    expect(screen.getByText("bold").closest("strong")).not.toBeNull();
    // The active (last) line shows its raw source in the textarea.
    expect(activeTextarea().value).toBe("plain");
  });

  it("edits the active line and reports the whole body", () => {
    const { onChange } = renderEditor("hello");
    fireEvent.change(activeTextarea(), { target: { value: "hello!" } });
    expect(onChange).toHaveBeenLastCalledWith("hello!");
  });

  it("splits the line on Enter at the caret", () => {
    const { onChange } = renderEditor("hello");
    const ta = activeTextarea();
    caretAt(ta, 2);
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("he\nllo");
  });

  it("merges into the previous line on Backspace at column 0", () => {
    const { onChange } = renderEditor("a\nb");
    const ta = activeTextarea();
    expect(ta.value).toBe("b"); // caret opens on the last line
    caretAt(ta, 0);
    fireEvent.keyDown(ta, { key: "Backspace" });
    expect(onChange).toHaveBeenLastCalledWith("ab");
  });

  it("does not hijack Backspace mid-line", () => {
    const { onChange } = renderEditor("a\nbc");
    const ta = activeTextarea();
    caretAt(ta, 1);
    fireEvent.keyDown(ta, { key: "Backspace" });
    // The browser handles the delete; we don't splice lines.
    expect(onChange).not.toHaveBeenCalled();
  });

  // Mobile soft keyboards deliver Enter / Backspace / Delete as `beforeinput`
  // events with a semantic `inputType` rather than as `keydown` "Enter" etc.,
  // so the same structural edits must work off `inputType` too.
  function beforeInput(ta: HTMLTextAreaElement, inputType: string) {
    fireEvent(
      ta,
      new InputEvent("beforeinput", {
        inputType,
        cancelable: true,
        bubbles: true,
      }),
    );
  }

  it("splits the line on a mobile insertLineBreak", () => {
    const { onChange } = renderEditor("hello");
    const ta = activeTextarea();
    caretAt(ta, 2);
    beforeInput(ta, "insertLineBreak");
    expect(onChange).toHaveBeenLastCalledWith("he\nllo");
  });

  it("splits the line on a mobile insertParagraph", () => {
    const { onChange } = renderEditor("hello");
    const ta = activeTextarea();
    caretAt(ta, 2);
    beforeInput(ta, "insertParagraph");
    expect(onChange).toHaveBeenLastCalledWith("he\nllo");
  });

  it("merges on a mobile deleteContentBackward at column 0", () => {
    const { onChange } = renderEditor("a\nb");
    const ta = activeTextarea();
    caretAt(ta, 0);
    beforeInput(ta, "deleteContentBackward");
    expect(onChange).toHaveBeenLastCalledWith("ab");
  });

  it("does not hijack a mobile deleteContentBackward mid-line", () => {
    const { onChange } = renderEditor("a\nbc");
    const ta = activeTextarea();
    caretAt(ta, 1);
    beforeInput(ta, "deleteContentBackward");
    expect(onChange).not.toHaveBeenCalled();
  });

  // A soft keyboard only emits a delete event when there is something before
  // the caret to delete, so an *empty* active line would otherwise swallow
  // Backspace — holding it erased a line to its start and then stopped instead
  // of merging into the line above. An invisible zero-width sentinel gives the
  // keyboard something to bite on so the merge still fires.
  const SENTINEL = "​";

  it("seeds an empty active line with the invisible sentinel", () => {
    renderEditor("a\n");
    const ta = activeTextarea();
    // The empty second line shows the sentinel, with the caret parked after it.
    expect(ta.value).toBe(SENTINEL);
    expect(ta.selectionStart).toBe(1);
  });

  it("merges an empty line into the previous one on Backspace", () => {
    const { onChange } = renderEditor("a\n");
    const ta = activeTextarea();
    fireEvent.keyDown(ta, { key: "Backspace" });
    expect(onChange).toHaveBeenLastCalledWith("a");
  });

  it("merges an empty line via a mobile deleteContentBackward", () => {
    const { onChange } = renderEditor("a\n");
    const ta = activeTextarea();
    beforeInput(ta, "deleteContentBackward");
    expect(onChange).toHaveBeenLastCalledWith("a");
  });

  it("merges when the sentinel is deleted into an empty field", () => {
    // Whatever path deletes the sentinel, an emptied field below the first
    // line means the swallowed Backspace: merge rather than store the sentinel.
    const { onChange } = renderEditor("a\n");
    const ta = activeTextarea();
    fireEvent.change(ta, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith("a");
  });

  it("never leaks the sentinel into the source when typing on an empty line", () => {
    const { onChange } = renderEditor("a\n");
    const ta = activeTextarea();
    // The keyboard inserts a character after the sentinel.
    fireEvent.change(ta, { target: { value: `${SENTINEL}x` } });
    expect(onChange).toHaveBeenLastCalledWith("a\nx");
  });

  // A rendered link opens on click rather than rolling the editing textarea
  // onto its line: tapping it (even while another line is being edited) must
  // leave that line formatted so the anchor's own click fires and navigates.
  // To edit the link you click just past it and backspace into it.
  it("opens a link on click instead of entering edit mode on its line", () => {
    renderEditor("[google](https://example.com)\nplain");
    const link = screen.getByText("google");
    expect(link.closest("a")?.getAttribute("href")).toBe("https://example.com");

    fireEvent.mouseDown(link);

    // The link's line stayed formatted (the anchor is still in the DOM) and the
    // active textarea is still the original last line — edit mode never rolled
    // onto the link's line.
    expect(screen.getByText("google").closest("a")).not.toBeNull();
    expect(activeTextarea().value).toBe("plain");
  });

  // Clicking the empty space below the note must always land the caret on a
  // blank line at the very bottom, creating one when the note doesn't already
  // end in a newline — otherwise the click would roll edit mode onto the last
  // content line (e.g. an image), turning it back into raw source. The blank
  // line is held locally and not reported as an edit: placing the caret is not
  // a change, so it must not bump the note's modified date.
  it("lands the caret on a fresh blank line below a note that lacks one without reporting an edit", () => {
    const { onChange, container } = renderEditor("![img](attachments/a.png)");
    // The outer scroll container is the empty note space below the content.
    const scroll = container.firstElementChild as HTMLElement;
    fireEvent.mouseDown(scroll, { target: scroll });
    // The caret now sits on the fresh empty last line, but the unchanged
    // document was never pushed back through onChange.
    expect(activeTextarea().value).toBe(SENTINEL);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not add another blank line when the note already ends in one", () => {
    const { onChange, container } = renderEditor("hello\n");
    const scroll = container.firstElementChild as HTMLElement;
    fireEvent.mouseDown(scroll, { target: scroll });
    // The note already ends in a blank line, so clicking below adds nothing.
    expect(onChange).not.toHaveBeenCalled();
  });

  // A live cloud pull replaces the open note's `body` prop while the editor is
  // mounted; the editor must adopt the new text in place (the "write here, see
  // it there" path) rather than keeping its mount-time copy.
  it("adopts an out-of-band change to the body prop", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MarkdownEditor body="first" onChange={onChange} {...editorProps} />,
    );
    expect(activeTextarea().value).toBe("first");

    // A remote pull lands a longer document while the note is open.
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

  // Opening an existing note (the app always passes focusOnMount={false}) must
  // not drop a raw textarea on the last line — every line, last one included,
  // renders as formatted Markdown until the user actually clicks to edit.
  describe("opening without focus (focusOnMount=false)", () => {
    function renderClosed(body: string) {
      const onChange = vi.fn();
      const utils = render(
        <MarkdownEditor
          body={body}
          onChange={onChange}
          focusOnMount={false}
          {...editorProps}
        />,
      );
      return { onChange, ...utils };
    }

    it("renders the whole note formatted with no active textarea on open", () => {
      renderClosed("**bold**\nplain");
      // No line is active, so there is no textarea at all.
      expect(screen.queryByRole("textbox")).toBeNull();
      // Both lines — including the last — render as formatted Markdown.
      expect(screen.getByText("bold").closest("strong")).not.toBeNull();
      expect(screen.getByText("plain")).not.toBeNull();
    });

    it("renders a single-line note formatted on open", () => {
      // The "or first if only one line" case from the report: a lone content
      // line must not open as a raw textarea — it stays a formatted heading.
      renderClosed("# Heading");
      expect(screen.queryByRole("textbox")).toBeNull();
      // The heading text renders, and not inside the raw-source textarea.
      const heading = screen.getByText("Heading");
      expect(heading).not.toBeNull();
      expect(heading.closest("textarea")).toBeNull();
    });

    it("enters edit mode on the clicked line, leaving the rest formatted", () => {
      renderClosed("**bold**\nplain");
      fireEvent.mouseDown(screen.getByText("plain"));
      // The clicked line is now the raw textarea; the other stays formatted.
      expect(activeTextarea().value).toBe("plain");
      expect(screen.getByText("bold").closest("strong")).not.toBeNull();
    });

    it("opens edit mode at the end via the imperative focus handle", () => {
      const ref = createRef<MarkdownEditorHandle>();
      const onChange = vi.fn();
      render(
        <MarkdownEditor
          ref={ref}
          body={"line one\nline two"}
          onChange={onChange}
          focusOnMount={false}
          {...editorProps}
        />,
      );
      expect(screen.queryByRole("textbox")).toBeNull();
      // The title hands focus down: like clicking the empty space below, the
      // editor lands the caret on a fresh blank line at the end of the note.
      act(() => ref.current!.focus());
      expect(activeTextarea().value).toBe(SENTINEL);
      // Placing the caret is not an edit — the trailing newline stays local.
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
