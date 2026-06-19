// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MarkdownEditor } from "../../src/ui/MarkdownEditor.tsx";

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
});
